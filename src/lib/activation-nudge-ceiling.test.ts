/**
 * Le rappel d'activation sous les plafonds des mails sans compte (C14,
 * 11.11.2026).
 *
 * Il écrit à l'adresse d'une clé dont la boîte n'a jamais été prouvée, depuis la
 * boîte qui livre aussi les clés payées : c'est un mail sans compte comme les
 * autres. Ce fichier prouve qu'il CÈDE à un plafond atteint (rien ne part, et
 * surtout aucune adresse n'est réservée : la réservation brûle l'unique rappel
 * d'une adresse) et que ce qu'il envoie est COMPTÉ sur le registre commun.
 *
 * Base propre à ce fichier (`test/hermetic-stats.ts`). Le relais est remplacé
 * par une doublure qui RETIENT les messages et se dit configurée : « rien n'est
 * parti » se lit sur le transport lui-même. L'alerte d'exploitation est retenue
 * aussi : remplir un plafond la fait partir, et le shell peut porter un vrai
 * jeton.
 *
 * Fixtures inventées (dépôt public) : adresses en alpha.example.net.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const relay = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string }>,
}));
vi.mock('./mail-transport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mail-transport.js')>();
  return {
    ...actual,
    isRelayConfigured: () => true,
    sendViaRelay: async (m: { to: string; subject: string }) => {
      relay.sent.push({ to: m.to, subject: m.subject });
      return true;
    },
    deliverViaRelay: async (m: { to: string; subject: string }) => {
      relay.sent.push({ to: m.to, subject: m.subject });
      return { outcome: 'sent' as const };
    },
  };
});
const ops = vi.hoisted(() => ({ fails: [] as string[], oks: [] as string[] }));
vi.mock('./ops-alert.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ops-alert.js')>();
  return {
    ...actual,
    opsFail: async (key: string) => {
      ops.fails.push(key);
    },
    opsOk: async (key: string) => {
      ops.oks.push(key);
    },
  };
});

const { getStatsDB } = await import('./db.js');
const { generateApiKey } = await import('./api-keys.js');
const { getNudgeLedger, runActivationPass } = await import('./activation-nudge-server.js');
const { kvSet } = await import('./forum-radar-server.js');
const {
  UNAUTHENTICATED_MAILS_GLOBAL_PER_DAY,
  UNAUTHENTICATED_MAILS_GLOBAL_PER_HOUR,
  resetUnauthenticatedMailCeilingAlert,
  unauthenticatedMailsLastDay,
  unauthenticatedMailsLastHour,
} = await import('./key-creation-guard.js');

const DAY_LIMIT = UNAUTHENTICATED_MAILS_GLOBAL_PER_DAY;
const HOUR_LIMIT = UNAUTHENTICATED_MAILS_GLOBAL_PER_HOUR;

/** Une clé gratuite à adresse, assez vieille pour un rappel, jamais appelée. */
function silentKey(email: string, ageHours: number): string {
  const k = generateApiKey(email);
  if (!k) throw new Error(`frappe impossible pour ${email}`);
  getStatsDB()
    .prepare(`UPDATE api_keys SET created_at = datetime('now', ?) WHERE key_prefix = ?`)
    .run(`-${ageHours} hours`, k.key_prefix);
  return k.key_prefix;
}

/** Des codes d'autres portes, comme s'ils étaient partis il y a `age`. */
function fillCodes(n: number, age: string): void {
  const insert = getStatsDB().prepare(
    `INSERT INTO verification_sends (ip_hash, email_hash, domain_hash, created_at)
       VALUES (?, ?, NULL, datetime('now', ?))`,
  );
  for (let i = 0; i < n; i++) insert.run(`autre-porte-${i}`, `autre-adresse-${i}`, age);
}

function claimed(email: string): number {
  return getNudgeLedger(1000).filter((r) => r.email === email).length;
}

beforeEach(() => {
  relay.sent.length = 0;
  ops.fails.length = 0;
  ops.oks.length = 0;
  delete process.env.ACTIVATION_NUDGE_DISABLED;
  // Crée le registre des mails de clé s'il n'existe pas encore, puis repart à vide.
  unauthenticatedMailsLastHour();
  const db = getStatsDB();
  db.prepare('DELETE FROM verification_sends').run();
  db.prepare('DELETE FROM free_key_mail_sends').run();
  db.prepare('DELETE FROM activation_nudges').run();
  db.prepare('DELETE FROM api_keys').run();
  resetUnauthenticatedMailCeilingAlert();
  // Aucune passe précédente : l'ordre d'une passe dépend de ce que la
  // précédente a retenu (11.11.2026).
  kvSet('activation_nudge_last_report', 'null');
});

describe('le rappel d’activation et les plafonds des mails sans compte', () => {
  it('au plafond de la journée, il attend : rien ne part, aucune adresse n’est réservée, le rapport le dit', async () => {
    const first = 'rappel-un@alpha.example.net';
    const second = 'rappel-deux@alpha.example.net';
    silentKey(first, 72);
    silentKey(second, 71);
    // Le plafond de la journée est plein, rempli il y a trois heures par
    // d'autres portes ; celui de l'heure est vide.
    fillCodes(DAY_LIMIT, '-3 hours');
    expect(unauthenticatedMailsLastHour()).toBe(0);
    expect(unauthenticatedMailsLastDay()).toBe(DAY_LIMIT);

    const report = await runActivationPass();

    expect(report.nudges_enabled).toBe(true);
    expect(report.nudges_skipped_reason).toBeUndefined();
    expect(report.nudge_candidates).toBe(2);
    expect(relay.sent).toEqual([]);
    expect(report.nudges_sent).toBe(0);
    expect(report.nudged).toEqual([]);
    // Les deux adresses gardent leur unique rappel pour une passe suivante.
    expect(claimed(first)).toBe(0);
    expect(claimed(second)).toBe(0);
    expect(report.nudges_held_by_ceiling).toBe(2);
    // Rien n'est inscrit pour un mail qui n'est pas parti.
    expect(unauthenticatedMailsLastDay()).toBe(DAY_LIMIT);
    expect(report.errors).toEqual([]);
  });

  it('au plafond de l’heure, il attend aussi', async () => {
    const only = 'rappel-heure@alpha.example.net';
    silentKey(only, 72);
    fillCodes(HOUR_LIMIT, '-5 minutes');
    expect(unauthenticatedMailsLastHour()).toBe(HOUR_LIMIT);

    const report = await runActivationPass();

    expect(relay.sent).toEqual([]);
    expect(claimed(only)).toBe(0);
    expect(report.nudges_held_by_ceiling).toBe(1);
  });

  it('chaque rappel parti est compté ; le plafond atteint en cours de passe arrête la passe, et la suivante reprend', async () => {
    const older = 'rappel-ancien@alpha.example.net';
    const newer = 'rappel-recent@alpha.example.net';
    silentKey(older, 72);
    silentKey(newer, 71);
    // Une seule place reste dans la journée.
    fillCodes(DAY_LIMIT - 1, '-3 hours');

    const first = await runActivationPass();

    // Le plus récent passe en premier (ordre de la sélection) et prend la
    // dernière place ; il est compté, et le plafond est alors atteint.
    expect(relay.sent.map((m) => m.to)).toEqual([newer]);
    expect(first.nudges_sent).toBe(1);
    expect(unauthenticatedMailsLastDay()).toBe(DAY_LIMIT);
    expect(claimed(newer)).toBe(1);
    // L'autre attend, sans réservation.
    expect(claimed(older)).toBe(0);
    expect(first.nudges_held_by_ceiling).toBe(1);

    // La journée se libère : la passe suivante écrit à l'adresse restante, la
    // compte, et n'écrit pas une seconde fois à la première.
    getStatsDB().prepare('DELETE FROM verification_sends').run();
    getStatsDB().prepare('DELETE FROM free_key_mail_sends').run();
    const second = await runActivationPass();
    expect(relay.sent.map((m) => m.to)).toEqual([newer, older]);
    expect(second.nudges_sent).toBe(1);
    expect(second.nudges_held_by_ceiling).toBe(0);
    expect(unauthenticatedMailsLastDay()).toBe(1);
    expect(claimed(older)).toBe(1);
    expect(claimed(newer)).toBe(1);
  });

  it('après une passe qui a retenu des rappels, la suivante sert les plus anciennes d’abord', async () => {
    const oldest = 'rappel-vingt-cinq-jours@alpha.example.net';
    const middle = 'rappel-dix-jours@alpha.example.net';
    const newest = 'rappel-trois-jours@alpha.example.net';
    silentKey(oldest, 25 * 24);
    silentKey(middle, 10 * 24);
    silentKey(newest, 3 * 24);
    // La journée est pleine : la passe retient les trois.
    fillCodes(DAY_LIMIT, '-3 hours');
    const first = await runActivationPass();
    expect(first.nudges_held_by_ceiling).toBe(3);
    expect(first.nudges_oldest_first).toBe(false);
    expect(relay.sent).toEqual([]);

    // Une seule place se libère : elle va à la clé la plus proche de la sortie
    // de la fenêtre, pas à la plus récente.
    getStatsDB().prepare('DELETE FROM verification_sends').run();
    fillCodes(DAY_LIMIT - 1, '-3 hours');
    const second = await runActivationPass();
    expect(second.nudges_oldest_first).toBe(true);
    expect(relay.sent.map((m) => m.to)).toEqual([oldest]);
    expect(second.nudges_held_by_ceiling).toBe(2);
    expect(claimed(newest)).toBe(0);
  });

  it('l’interrupteur d’arrêt reste avant tout : il ne lit ni n’alimente le plafond', async () => {
    silentKey('rappel-arret@alpha.example.net', 72);
    process.env.ACTIVATION_NUDGE_DISABLED = '1';
    try {
      const report = await runActivationPass();
      expect(report.nudges_skipped_reason).toBe('kill_switch');
      expect(report.nudges_held_by_ceiling).toBe(0);
      expect(relay.sent).toEqual([]);
      expect(unauthenticatedMailsLastDay()).toBe(0);
    } finally {
      delete process.env.ACTIVATION_NUDGE_DISABLED;
    }
  });
});
