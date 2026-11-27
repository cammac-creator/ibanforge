import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { closeAll, getStatsDB } from '../src/lib/db.js';
import { generateApiKey, validateApiKey } from '../src/lib/api-keys.js';
import {
  claimThresholdNotice,
  listRecipients,
  readThresholds,
  startRecipient,
  takeAlertCodeSlot,
  writeThresholds,
} from '../src/lib/quota-alerts.js';

/**
 * L'outil d'oubli efface les réglages d'alerte des clés du client (seuils,
 * verrous, journal des codes, adresses ajoutées), ET l'adresse du client quand
 * elle a été ajoutée aux alertes de la clé d'UN AUTRE. Lancé pour de vrai, dans
 * un processus à part, comme `forget-customer.account.test.ts`.
 *
 * Fixtures inventées (dépôt public).
 */
const SCRIPT = resolve(__dirname, 'forget-customer.cjs');
const DB_PATH = process.env.STATS_DB_PATH as string;
const RUN = Date.now();

function forget(email: string): string {
  return execFileSync(process.execPath, [SCRIPT, email, '--execute'], {
    env: { ...process.env, STATS_DB_PATH: DB_PATH },
    encoding: 'utf8',
  });
}

const count = (table: string, hash: string): number =>
  (
    getStatsDB().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE key_hash = ?`).get(hash) as {
      n: number;
    }
  ).n;

describe('forget-customer.cjs et les alertes de quota', () => {
  afterAll(() => closeAll());

  it('efface les quatre tables des clés du client, et laisse celles du voisin', () => {
    const mine = `oubli-${RUN}@alpha.example.net`;
    const theirs = `voisin-${RUN}@alpha.example.net`;
    const keyMine = validateApiKey(generateApiKey(mine)!.api_key).keyHash;
    const keyTheirs = validateApiKey(generateApiKey(theirs)!.api_key).keyHash;
    for (const k of [keyMine, keyTheirs]) {
      writeThresholds(k, [50, 90]);
      claimThresholdNotice(k, '2034-01', 90);
      startRecipient(k, `ajoutee-${RUN}@corp-a.example.net`, 'AAAAAAAA');
      takeAlertCodeSlot(k);
    }
    forget(mine);
    for (const table of [
      'quota_alert_settings',
      'quota_threshold_notices',
      'quota_alert_recipients',
      'quota_alert_code_sends',
    ]) {
      expect(count(table, keyMine), table).toBe(0);
      expect(count(table, keyTheirs), table).toBeGreaterThan(0);
    }
    expect(readThresholds(keyTheirs)).toEqual([50, 90]);
  });

  it('retire l’adresse du client ajoutée aux alertes de la clé d’un autre, sans toucher aux autres adresses', () => {
    const owner = `proprio-${RUN}@alpha.example.net`;
    const keyOwner = validateApiKey(generateApiKey(owner)!.api_key).keyHash;
    const asked = `demande-${RUN}@corp-b.example.net`;
    const other = `autre-${RUN}@corp-c.example.net`;
    startRecipient(keyOwner, asked, 'AAAAAAAA');
    startRecipient(keyOwner, other, 'BBBBBBBB');
    forget(asked);
    expect(listRecipients(keyOwner).map((r) => r.email)).toEqual([other]);
  });
});
