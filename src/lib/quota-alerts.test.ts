/**
 * Les réglages d'alerte d'une clé : seuils, verrous, adresses ajoutées
 * (chantier « compte client et alertes », lot 1). Fixtures inventées
 * (dépôt public) : alpha.example.net.
 */
import { describe, it, expect } from 'vitest';
import { getStatsDB } from './db.js';
import {
  MAX_ALERT_RECIPIENTS,
  claimOpsNotice,
  claimThresholdNotice,
  confirmRecipient,
  confirmedRecipients,
  listRecipients,
  purgeUnconfirmedRecipients,
  readThresholds,
  recipientSlotAvailable,
  releaseThresholdNotice,
  removeRecipient,
  startRecipient,
  validateThresholdChoice,
  writeThresholds,
} from './quota-alerts.js';
import { recordQuotaNotice } from './api-keys.js';
import { createHash } from 'node:crypto';
import { drawRecipientCode, isRecipientCode, normalizeRecipientCode } from './quota-alerts.js';

const RUN = `${Date.now()}`;
let n = 0;
const hash = () => `alerts-${RUN}-${++n}`;

describe('les seuils choisis', () => {
  it('sans réglage : 80 % seul, comme avant le chantier', () => {
    expect(readThresholds(hash())).toEqual([80]);
  });

  it('se règlent, triés, et se relisent', () => {
    const k = hash();
    writeThresholds(k, [90, 50]);
    expect(readThresholds(k)).toEqual([90, 50].sort((a, b) => a - b));
    writeThresholds(k, [100]);
    expect(readThresholds(k)).toEqual([100]);
  });

  it('un choix hors liste, vide ou mal formé est refusé', () => {
    for (const bad of [[], [95], ['80'], [80, 'x'], 'all', null, [50, 80, 90, 100, 100]]) {
      expect(validateThresholdChoice(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(validateThresholdChoice([90, 50, 50])).toEqual([50, 90]);
  });

  it('une ligne illisible vaut le défaut, jamais une clé sans alerte', () => {
    const k = hash();
    getStatsDB()
      .prepare('INSERT INTO quota_alert_settings (key_hash, thresholds) VALUES (?, ?)')
      .run(k, 'abc,,12');
    expect(readThresholds(k)).toEqual([80]);
  });
});

describe('les verrous : un mail par (clé, période, seuil)', () => {
  it('chaque seuil se prend une fois par période', () => {
    const k = hash();
    for (const t of [50, 80, 90, 100] as const) {
      expect(claimThresholdNotice(k, '2030-01', t), `${t} neuf`).toBe(true);
      expect(claimThresholdNotice(k, '2030-01', t), `${t} déjà pris`).toBe(false);
    }
    // La période suivante se réarme.
    expect(claimThresholdNotice(k, '2030-02', 50)).toBe(true);
  });

  it('le seuil de 80 % reste sur quota_notices : une clé déjà avertie ce mois-ci ne l’est pas deux fois', () => {
    const k = hash();
    recordQuotaNotice(k, '2030-03'); // l'alerte d'avant la mise en ligne
    expect(claimThresholdNotice(k, '2030-03', 80)).toBe(false);
    expect(claimThresholdNotice(k, '2030-03', 90)).toBe(true);
  });

  it('rendre un verrou le rouvre', () => {
    const k = hash();
    expect(claimThresholdNotice(k, '2030-04', 90)).toBe(true);
    releaseThresholdNotice(k, '2030-04', 90);
    expect(claimThresholdNotice(k, '2030-04', 90)).toBe(true);
    expect(claimThresholdNotice(k, '2030-04', 80)).toBe(true);
    releaseThresholdNotice(k, '2030-04', 80);
    expect(claimThresholdNotice(k, '2030-04', 80)).toBe(true);
  });

  it('le verrou de l’exploitant est à part de celui du client', () => {
    const k = hash();
    expect(claimOpsNotice(k, '2030-05', 90)).toBe(true);
    expect(claimOpsNotice(k, '2030-05', 90)).toBe(false);
    expect(claimThresholdNotice(k, '2030-05', 90)).toBe(true);
  });
});

describe('les adresses ajoutées', () => {
  it('une adresse en attente ne reçoit rien : elle n’est pas dans la liste des destinataires', () => {
    const k = hash();
    expect(startRecipient(k, 'colleague@alpha.example.net', '123456')).toEqual({ ok: true });
    expect(listRecipients(k)).toEqual([
      { email: 'colleague@alpha.example.net', status: 'pending' },
    ]);
    expect(confirmedRecipients(k)).toEqual([]);
  });

  it('le bon code la confirme, une seule fois', () => {
    const k = hash();
    startRecipient(k, 'colleague@alpha.example.net', '123456');
    expect(confirmRecipient(k, 'colleague@alpha.example.net', '000000')).toEqual({ ok: false });
    expect(confirmRecipient(k, 'colleague@alpha.example.net', '123456')).toEqual({ ok: true });
    expect(confirmedRecipients(k)).toEqual(['colleague@alpha.example.net']);
    // Le code est consommé.
    expect(confirmRecipient(k, 'colleague@alpha.example.net', '123456')).toEqual({ ok: false });
    expect(startRecipient(k, 'colleague@alpha.example.net', '654321')).toEqual({
      ok: false,
      reason: 'already_confirmed',
    });
  });

  it('trois adresses au plus, en attente comprises', () => {
    const k = hash();
    expect(MAX_ALERT_RECIPIENTS).toBe(3);
    for (const who of ['a', 'b', 'c']) {
      expect(startRecipient(k, `${who}@alpha.example.net`, '111111')).toEqual({ ok: true });
    }
    expect(startRecipient(k, 'd@alpha.example.net', '111111')).toEqual({
      ok: false,
      reason: 'full',
    });
    expect(recipientSlotAvailable(k, 'd@alpha.example.net')).toBe('full');
    // Une adresse déjà en attente peut recevoir un code neuf.
    expect(recipientSlotAvailable(k, 'a@alpha.example.net')).toBe('ok');
    // Retirer en libère une.
    expect(removeRecipient(k, 'b@alpha.example.net')).toBe(true);
    expect(startRecipient(k, 'd@alpha.example.net', '111111')).toEqual({ ok: true });
  });

  it('cinq mauvais essais verrouillent le code, même devant le bon', () => {
    const k = hash();
    startRecipient(k, 'colleague@alpha.example.net', '123456');
    for (let i = 0; i < 5; i += 1) {
      expect(confirmRecipient(k, 'colleague@alpha.example.net', `00000${i}`).ok).toBe(false);
    }
    expect(confirmRecipient(k, 'colleague@alpha.example.net', '123456').ok).toBe(false);
    // Un code neuf remet les essais à zéro.
    startRecipient(k, 'colleague@alpha.example.net', '222222');
    expect(confirmRecipient(k, 'colleague@alpha.example.net', '222222').ok).toBe(true);
  });

  it('un code expiré ne confirme pas et la ligne part', () => {
    const k = hash();
    startRecipient(k, 'colleague@alpha.example.net', '123456');
    getStatsDB()
      .prepare(
        "UPDATE quota_alert_recipients SET code_expires_at = datetime('now', '-1 minute') WHERE key_hash = ?",
      )
      .run(k);
    expect(confirmRecipient(k, 'colleague@alpha.example.net', '123456').ok).toBe(false);
    expect(listRecipients(k)).toEqual([]);
  });

  it('le code n’est jamais stocké en clair', () => {
    const k = hash();
    startRecipient(k, 'colleague@alpha.example.net', '123456');
    const row = getStatsDB()
      .prepare('SELECT code_hash FROM quota_alert_recipients WHERE key_hash = ?')
      .get(k) as { code_hash: string };
    expect(row.code_hash).not.toContain('123456');
    expect(row.code_hash).toHaveLength(64);
  });

  it('se retire à tout moment, confirmée ou non', () => {
    const k = hash();
    startRecipient(k, 'a@alpha.example.net', '111111');
    startRecipient(k, 'b@alpha.example.net', '222222');
    confirmRecipient(k, 'b@alpha.example.net', '222222');
    expect(removeRecipient(k, 'a@alpha.example.net')).toBe(true);
    expect(removeRecipient(k, 'b@alpha.example.net')).toBe(true);
    expect(removeRecipient(k, 'b@alpha.example.net')).toBe(false);
    expect(listRecipients(k)).toEqual([]);
  });

  it('les adresses jamais confirmées sont purgées, les confirmées jamais', () => {
    const k = hash();
    startRecipient(k, 'a@alpha.example.net', '111111');
    startRecipient(k, 'b@alpha.example.net', '222222');
    confirmRecipient(k, 'b@alpha.example.net', '222222');
    getStatsDB()
      .prepare(
        "UPDATE quota_alert_recipients SET code_expires_at = datetime('now', '-2 days') WHERE key_hash = ? AND status = 'pending'",
      )
      .run(k);
    expect(purgeUnconfirmedRecipients()).toBeGreaterThanOrEqual(1);
    expect(listRecipients(k)).toEqual([{ email: 'b@alpha.example.net', status: 'confirmed' }]);
  });
});

describe('le code d’une adresse ajoutée', () => {
  it('huit caractères sans ambiguïté, jamais six chiffres, saisi sans égard à la casse ni aux tirets', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = drawRecipientCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(
        isRecipientCode(
          normalizeRecipientCode(`${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase()),
        ),
      ).toBe(true);
    }
    expect(isRecipientCode('123456')).toBe(false);
    expect(isRecipientCode('ABCDEFG0')).toBe(false);
  });

  it('s’enregistre par HMAC avec le secret du serveur, pas par un sha256 nu', () => {
    const k = hash();
    startRecipient(k, 'colleague@alpha.example.net', 'K7M2QX4P');
    const row = getStatsDB()
      .prepare('SELECT code_hash FROM quota_alert_recipients WHERE key_hash = ?')
      .get(k) as { code_hash: string };
    expect(row.code_hash).not.toBe(createHash('sha256').update('K7M2QX4P').digest('hex'));
    expect(confirmRecipient(k, 'colleague@alpha.example.net', 'k7m2-qx4p').ok).toBe(true);
  });
});
