/**
 * La vie des réglages d'alerte autour d'une clé : rotation, révocation,
 * changement d'adresse par l'administration (chantier « compte client et
 * alertes », lot 1). Fixtures inventées (dépôt public).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { apiKeys } from '../routes/api-keys.js';
import { getStatsDB } from './db.js';
import { generateApiKey, revokeApiKey, rotateApiKey, validateApiKey } from './api-keys.js';
import {
  claimThresholdNotice,
  confirmRecipient,
  confirmedRecipients,
  listRecipients,
  purgeSettingsOfDeadKeys,
  readThresholds,
  startRecipient,
  takeAlertCodeSlot,
  writeThresholds,
} from './quota-alerts.js';

const RUN = Date.now();
let n = 0;
const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

function fresh() {
  n += 1;
  const email = `cycle${n}-${RUN}@alpha.example.net`;
  const made = generateApiKey(email)!;
  return {
    email,
    raw: made.api_key,
    prefix: made.key_prefix,
    hash: validateApiKey(made.api_key).keyHash,
  };
}

function seed(hash: string): void {
  writeThresholds(hash, [50, 90]);
  claimThresholdNotice(hash, '2034-02', 90);
  startRecipient(hash, `ajoutee${n}-${RUN}@corp-d.example.net`, 'CCCCCCCC');
  takeAlertCodeSlot(hash);
}

const rows = (table: string, hash: string): number =>
  (
    getStatsDB().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE key_hash = ?`).get(hash) as {
      n: number;
    }
  ).n;

const TABLES = [
  'quota_alert_settings',
  'quota_threshold_notices',
  'quota_alert_recipients',
  'quota_alert_code_sends',
];

describe('rotation d’une clé', () => {
  it('déplace les quatre tables sur la nouvelle clé : rien n’est perdu, aucune alerte rouverte', () => {
    const k = fresh();
    seed(k.hash);
    const rotated = rotateApiKey(k.raw)!;
    const newHash = validateApiKey(rotated.api_key).keyHash;
    for (const table of TABLES) {
      expect(rows(table, k.hash), `${table} ancienne`).toBe(0);
      expect(rows(table, newHash), `${table} nouvelle`).toBe(1);
    }
    expect(readThresholds(newHash)).toEqual([50, 90]);
    // Le verrou a suivi : le même seuil du même mois ne se reprend pas.
    expect(claimThresholdNotice(newHash, '2034-02', 90)).toBe(false);
  });
});

describe('clé révoquée ou supprimée : 30 jours puis purge', () => {
  it('purge les réglages et les adresses d’une clé désactivée depuis plus de 30 jours, pas avant', () => {
    const k = fresh();
    seed(k.hash);
    revokeApiKey(k.raw);
    // Fraîchement révoquée : tout reste.
    purgeSettingsOfDeadKeys();
    for (const table of TABLES) expect(rows(table, k.hash), table).toBe(1);
    getStatsDB()
      .prepare(
        "UPDATE api_keys SET deactivated_at = datetime('now', '-29 days') WHERE key_hash = ?",
      )
      .run(k.hash);
    purgeSettingsOfDeadKeys();
    expect(rows('quota_alert_recipients', k.hash)).toBe(1);
    getStatsDB()
      .prepare(
        "UPDATE api_keys SET deactivated_at = datetime('now', '-31 days') WHERE key_hash = ?",
      )
      .run(k.hash);
    purgeSettingsOfDeadKeys();
    for (const table of TABLES) expect(rows(table, k.hash), table).toBe(0);
  });

  it('une clé active garde tout, et une clé SUPPRIMÉE de la base est purgée', () => {
    const live = fresh();
    seed(live.hash);
    const gone = `supprimee-${RUN}-${++n}`;
    seed(gone);
    purgeSettingsOfDeadKeys();
    for (const table of TABLES) expect(rows(table, live.hash), table).toBe(1);
    for (const table of TABLES) expect(rows(table, gone), table).toBe(0);
  });
});

describe('l’administration change l’adresse d’une clé', () => {
  it('ses adresses ajoutées (confirmées pour l’ancienne adresse) sont retirées', async () => {
    process.env.ADMIN_SECRET = 'secret-de-test-alertes';
    const k = fresh();
    const colleague = `collegue${n}-${RUN}@corp-e.example.net`;
    startRecipient(k.hash, colleague, 'DDDDDDDD');
    expect(confirmRecipient(k.hash, colleague, 'DDDDDDDD').ok).toBe(true);
    expect(confirmedRecipients(k.hash)).toEqual([colleague]);
    const app = new Hono();
    app.route('/', apiKeys);
    const res = await app.request('/v1/admin/keys/relabel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': process.env.ADMIN_SECRET },
      body: JSON.stringify({
        key_prefixes: [k.prefix],
        email: `nouvelle${n}-${RUN}@alpha.example.net`,
      }),
    });
    expect(res.status).toBe(200);
    expect(listRecipients(k.hash)).toEqual([]);
  });
});
