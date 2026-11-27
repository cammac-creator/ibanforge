import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALERT_THRESHOLD_CHOICES,
  isCompleteAlertCode,
  normalizeAlertCode,
  readAlertReply,
  readAlertSettings,
  sheetFromOverviewKey,
  sheetFromReport,
  formatUtcStamp,
  type KeyReportPayload,
} from './account-overview';

/**
 * Les alertes de quota sur la page du compte (chantier « compte client et
 * alertes », lot 1, 27.11.2026). Fixtures inventées (dépôt public).
 */
const PRO_KEY = {
  key_prefix: 'ifk_5e6f7a8b',
  created_at: '2026-08-03T10:00:00Z',
  plan: 'pro',
  allowance: { basis: 'monthly', limit: 10000, used: 9000, remaining: 1000 },
  credits: null,
  subscription: { plan: 'pro', status: 'active', manage_url: 'https://billing.stripe.com/p/login/demo' },
  calls_this_month: 9000,
  last_call_at: '2026-11-26T08:15:00Z',
  alerts: [
    { kind: 'quota_90', sent_at: '2026-11-26T09:00:00Z' },
    { kind: 'quota_50', sent_at: '2026-11-20T09:00:00Z' },
    { kind: 'quota_80', sent_at: '2026-11-23T09:00:00Z' },
    { kind: 'something_else', sent_at: '2026-11-24T09:00:00Z' },
  ],
  resets_at: '2026-12-01T00:00:00.000Z',
  alert_settings: {
    thresholds: [50, 80, 95],
    recipients: [
      { email: 'colleague@alpha.example.net', status: 'confirmed' },
      { email: 'other@alpha.example.net', status: 'pending' },
      { status: 'confirmed' },
    ],
    max_recipients: 3,
  },
  actions: { topup: null, subscribe_pro: null, manage_subscription: null },
};

describe('la liste des seuils est celle de l’API', () => {
  it('50, 80, 90, 100, lue dans le source de l’API à l’exécution (jamais importée)', () => {
    const api = readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'quota-period.ts'), 'utf8');
    const m = /ALERT_THRESHOLDS = \[([\d,\s]+)\] as const/.exec(api);
    expect(m, 'ALERT_THRESHOLDS n’est plus lisible dans src/lib/quota-period.ts').not.toBeNull();
    const served = m![1].split(',').map((n) => Number(n.trim()));
    expect([...ALERT_THRESHOLD_CHOICES]).toEqual(served);
  });
});

describe('la fiche d’une clé du compte', () => {
  const sheet = sheetFromOverviewKey(PRO_KEY, '2026-11')!;

  it('garde les alertes des quatre seuils et écarte une sorte inconnue', () => {
    expect(sheet.alerts?.map((a) => a.kind)).toEqual(['quota_90', 'quota_50', 'quota_80']);
  });

  it('porte la date de remise à zéro, dite par les mêmes mots que le reste de la page', () => {
    expect(sheet.resetsAt).toBe('2026-12-01T00:00:00.000Z');
    expect(formatUtcStamp(sheet.resetsAt)).toBe('2026-12-01 00:00 UTC');
  });

  it('porte les réglages : seuils de la liste seulement, adresses lisibles seulement', () => {
    expect(sheet.alertSettings).toEqual({
      thresholds: [50, 80],
      recipients: [
        { email: 'colleague@alpha.example.net', status: 'confirmed' },
        { email: 'other@alpha.example.net', status: 'pending' },
      ],
      maxRecipients: 3,
      configurable: true,
    });
  });

  it('une clé sans allocation qui garde des adresses : configurable faux, à retirer seulement', () => {
    const s = readAlertSettings({
      thresholds: [],
      recipients: [{ email: 'colleague@alpha.example.net', status: 'confirmed' }],
      max_recipients: 3,
      configurable: false,
    });
    expect(s?.configurable).toBe(false);
    expect(s?.recipients).toHaveLength(1);
  });

  it('sans réglage servi (API d’avant), la fiche n’invente rien', () => {
    const bare = sheetFromOverviewKey(
      { ...PRO_KEY, resets_at: undefined, alert_settings: undefined },
      '2026-11',
    )!;
    expect(bare.resetsAt).toBeNull();
    expect(bare.alertSettings).toBeNull();
    expect(readAlertSettings('nope')).toBeNull();
  });

  it('une date illisible n’est pas affichée', () => {
    expect(sheetFromOverviewKey({ ...PRO_KEY, resets_at: 'demain' }, '2026-11')!.resetsAt).toBeNull();
  });
});

describe('une clé collée', () => {
  const report = (usage: Record<string, unknown>): KeyReportPayload =>
    ({
      key_prefix: 'ifk_5e6f7a8b',
      usage: { used: 10, limit: 200, remaining: 190, month: '2026-11', basis: 'monthly', ...usage },
      report: {} as KeyReportPayload['report'],
    }) as KeyReportPayload;

  it('dit quand le compteur repart, mais ne règle aucune alerte', () => {
    const sheet = sheetFromReport(report({ resets_at: '2026-12-01T00:00:00.000Z' }))!;
    expect(sheet.resetsAt).toBe('2026-12-01T00:00:00.000Z');
    expect(sheet.alertSettings).toBeNull();
  });

  it('une assiette de vie ne repart à aucune date', () => {
    const sheet = sheetFromReport(report({ basis: 'lifetime', resets_at: '2026-12-01T00:00:00.000Z' }))!;
    expect(sheet.resetsAt).toBeNull();
  });
});

describe('la réponse d’un geste sur les alertes', () => {
  it('lit le succès, la session terminée et chaque refus', () => {
    expect(readAlertReply({ status: 200, body: { thresholds: [80] } })).toEqual({
      kind: 'ok',
      body: { thresholds: [80] },
    });
    expect(readAlertReply({ status: 202, body: { status: 'code_sent' } }).kind).toBe('ok');
    expect(readAlertReply({ status: 401, body: { error: 'signed_out' } })).toEqual({
      kind: 'session_ended',
    });
    const reasons: Record<string, string> = {
      invalid_email: 'address',
      disposable_email: 'address',
      undeliverable_email: 'address',
      address_not_allowed: 'address',
      own_address: 'own',
      recipients_full: 'full',
      already_confirmed: 'already',
      invalid_code: 'code',
      invalid_thresholds: 'thresholds',
      code_rate_limited: 'rate',
      code_unavailable: 'service',
    };
    for (const [error, reason] of Object.entries(reasons)) {
      expect(readAlertReply({ status: 400, body: { error } }), error).toEqual({
        kind: 'failed',
        reason,
      });
    }
    expect(readAlertReply({ status: 0, body: null })).toEqual({ kind: 'failed', reason: 'service' });
  });
});

describe('le code d’une adresse ajoutée', () => {
  it('huit lettres et chiffres, saisis sans égard à la casse ni aux tirets ; jamais six chiffres', () => {
    expect(isCompleteAlertCode(normalizeAlertCode('k7m2-qx4p'))).toBe(true);
    expect(isCompleteAlertCode(normalizeAlertCode(' K7M2 QX4P '))).toBe(true);
    expect(isCompleteAlertCode('123456')).toBe(false);
    expect(isCompleteAlertCode('K7M2QX40')).toBe(false);
  });
});
