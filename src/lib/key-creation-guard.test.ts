import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeIpForGuard,
  keyCreationSource,
  countKeyCreations,
  recordKeyCreation,
  createVerificationChallenge,
  checkVerificationCode,
  VERIFICATION_MAX_ATTEMPTS,
  challengeSendAllowed,
  recordVerificationSend,
  markVerificationOutcome,
  verificationDelivery,
  purgeExpiredVerifications,
  VERIFICATION_SENDS_PER_EMAIL_DAY,
  VERIFICATION_SENDS_PER_SOURCE_DAY,
  CHALLENGE_GRACE_MINUTES,
  CLAIM_SUCCESS_PER_SOURCE_DAY,
  DAILY_KEY_CREATION_LIMIT,
} from './key-creation-guard.js';
import { getStatsDB } from './db.js';

const RUN = Date.now();

/**
 * Le défi posé à la main, comme la route le fait.
 *
 * `createVerificationChallenge` rend `string | { refused }` depuis que la
 * réclamation partage la table des défis. Aucun cas de ce fichier n'a de cible
 * concurrente, donc le refus ne peut pas survenir — mais le narrow doit être
 * écrit, sinon le type du code n'est pas une chaîne pour tsc.
 */
function plant(email: string, source: string | null, keyPrefix?: string | null): string {
  const r = createVerificationChallenge(email, source, keyPrefix);
  if (typeof r !== 'string') throw new Error(`challenge refused: ${r.refused}`);
  return r;
}

describe('normalizeIpForGuard', () => {
  it('passes IPv4 through unchanged', () => {
    expect(normalizeIpForGuard('203.0.113.87')).toBe('203.0.113.87');
  });

  it('collapses IPv6 to its /64 — one subscriber must not get millions of identities', () => {
    expect(normalizeIpForGuard('2001:db8:aaaa:bbbb:1111:2222:3333:4444')).toBe(
      '2001:db8:aaaa:bbbb',
    );
    expect(normalizeIpForGuard('2001:DB8:AAAA:BBBB:9999:8888:7777:6666')).toBe(
      '2001:db8:aaaa:bbbb',
    );
  });

  it('returns null source when the IP is unknown — the guard fails open, never bricks signups', () => {
    expect(keyCreationSource(null)).toBeNull();
    expect(keyCreationSource(undefined)).toBeNull();
  });
});

describe('creation counting', () => {
  it('counts only the window asked for', () => {
    const src = `guard-test-${RUN}`;
    expect(countKeyCreations(src, 24)).toBe(0);
    recordKeyCreation(src);
    recordKeyCreation(src);
    expect(countKeyCreations(src, 24)).toBe(2);
    // Backdate one row past the window: it must stop counting.
    getStatsDB()
      .prepare(
        "UPDATE key_creations SET created_at = datetime('now', '-2 days') WHERE ip_hash = ? AND id = (SELECT MIN(id) FROM key_creations WHERE ip_hash = ?)",
      )
      .run(src, src);
    expect(countKeyCreations(src, 24)).toBe(1);
    expect(countKeyCreations(src, 24 * 7)).toBe(2);
  });

  it('stores the client library string and minted prefix when given', () => {
    const src = `guard-ua-${RUN}`;
    recordKeyCreation(src, 'demo-http-client/9.9.9', 'ifk_testpref1');
    const row = getStatsDB()
      .prepare(
        'SELECT user_agent, key_prefix FROM key_creations WHERE ip_hash = ? ORDER BY id DESC LIMIT 1',
      )
      .get(src) as { user_agent: string | null; key_prefix: string | null };
    expect(row.user_agent).toBe('demo-http-client/9.9.9');
    expect(row.key_prefix).toBe('ifk_testpref1');
  });

  it('keeps the older two-argument shape working — both new fields default to null', () => {
    const src = `guard-legacy-${RUN}`;
    recordKeyCreation(src);
    const row = getStatsDB()
      .prepare(
        'SELECT user_agent, key_prefix FROM key_creations WHERE ip_hash = ? ORDER BY id DESC LIMIT 1',
      )
      .get(src) as { user_agent: string | null; key_prefix: string | null };
    expect(row.user_agent).toBeNull();
    expect(row.key_prefix).toBeNull();
  });
});

describe('verification challenge', () => {
  it('accepts the right code exactly once', () => {
    const email = `verif-${RUN}@alpha-corp.example.net`;
    const code = plant(email, 'src');
    expect(code).toMatch(/^\d{6}$/);
    expect(checkVerificationCode(email, code)).toEqual({ ok: true });
    // Consumed on success — replay must fail.
    expect(checkVerificationCode(email, code)).toEqual({ ok: false, reason: 'no_challenge' });
  });

  it('locks after too many wrong attempts — 6 digits must not be brute-forceable', () => {
    const email = `verif-lock-${RUN}@alpha-corp.example.net`;
    const code = plant(email, 'src');
    for (let i = 0; i < VERIFICATION_MAX_ATTEMPTS; i++) {
      expect(checkVerificationCode(email, '000000').ok).toBe(false);
    }
    // Even the RIGHT code is refused once the lock is on.
    expect(checkVerificationCode(email, code)).toEqual({ ok: false, reason: 'too_many_attempts' });
  });

  it('refuses an expired code and clears it', () => {
    const email = `verif-exp-${RUN}@alpha-corp.example.net`;
    const code = plant(email, 'src');
    getStatsDB()
      .prepare(
        "UPDATE pending_verifications SET expires_at = datetime('now', '-1 minute') WHERE email = ?",
      )
      .run(email);
    expect(checkVerificationCode(email, code)).toEqual({ ok: false, reason: 'expired' });
    expect(checkVerificationCode(email, code)).toEqual({ ok: false, reason: 'no_challenge' });
  });

  it('re-requesting a challenge replaces the previous code', () => {
    const email = `verif-re-${RUN}@alpha-corp.example.net`;
    const first = plant(email, 'src');
    const second = plant(email, 'src');
    if (first !== second) {
      expect(checkVerificationCode(email, first).ok).toBe(false);
    }
    expect(checkVerificationCode(email, second)).toEqual({ ok: true });
  });
});

describe('verification send limits (mail-bombing guard)', () => {
  it('caps sends per recipient — nobody needs a 4th code in a day', () => {
    const src = `send-src-${RUN}-a`;
    const email = `victim-${RUN}@bank.example.net`;
    for (let i = 0; i < VERIFICATION_SENDS_PER_EMAIL_DAY; i++) {
      expect(challengeSendAllowed(src, email)).toEqual({ ok: true });
      recordVerificationSend(src, email);
    }
    // Even from a DIFFERENT source, the recipient is now protected.
    expect(challengeSendAllowed(`${src}-other`, email)).toEqual({ ok: false, reason: 'recipient' });
  });

  it('caps sends per source — bounds a distributed spray', () => {
    const src = `send-src-${RUN}-b`;
    // Fresh address each time so the recipient cap never fires first.
    for (let i = 0; i < VERIFICATION_SENDS_PER_SOURCE_DAY; i++) {
      const email = `spray-${RUN}-${i}@example.net`;
      expect(challengeSendAllowed(src, email)).toEqual({ ok: true });
      recordVerificationSend(src, email);
    }
    expect(challengeSendAllowed(src, `spray-${RUN}-final@example.net`)).toEqual({
      ok: false,
      reason: 'source',
    });
  });

  it('a null source is still bounded by the recipient cap (fail-open on source only)', () => {
    const email = `nullsrc-${RUN}@example.net`;
    for (let i = 0; i < VERIFICATION_SENDS_PER_EMAIL_DAY; i++) {
      expect(challengeSendAllowed(null, email)).toEqual({ ok: true });
      recordVerificationSend(null, email);
    }
    expect(challengeSendAllowed(null, email)).toEqual({ ok: false, reason: 'recipient' });
  });

  it('purges expired pending challenges and stale send rows', () => {
    const db = getStatsDB();
    const email = `purge-${RUN}@example.net`;
    // Insert directly in the target state — recordVerificationSend would itself
    // purge the expired pending row and defeat what we mean to test.
    db.prepare(
      "INSERT INTO pending_verifications (email, code_hash, ip_hash, attempts, created_at, expires_at) VALUES (?, 'h', 'src', 0, datetime('now','-20 minutes'), datetime('now','-1 minute'))",
    ).run(email);
    db.prepare(
      "INSERT INTO verification_sends (ip_hash, email_hash, created_at) VALUES ('purge-src', 'eh', datetime('now','-3 days'))",
    ).run();
    const removed = purgeExpiredVerifications();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM pending_verifications WHERE email = ?').get(email),
    ).toEqual({ n: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM verification_sends WHERE ip_hash = 'purge-src'").get(),
    ).toEqual({ n: 0 });
  });
});

/**
 * The verification channel now records what the relay did with each code.
 * Before 21/08 it recorded only that a code had been sent, so a channel
 * refusing everything looked exactly like a channel working perfectly.
 */
describe('verificationDelivery', () => {
  beforeEach(() => {
    getStatsDB().prepare('DELETE FROM verification_sends').run();
  });

  it('reports nothing to judge when nothing was attempted', () => {
    const d = verificationDelivery(24);
    expect(d.attempted).toBe(0);
    // null, not 0: an idle channel has not proven itself healthy.
    expect(d.refused_ratio).toBeNull();
  });

  it('counts a refusal recorded against its own send', () => {
    const id = recordVerificationSend('net-hash', 'acme@example.com');
    markVerificationOutcome(id, false);
    const d = verificationDelivery(24);
    expect(d.attempted).toBe(1);
    expect(d.refused).toBe(1);
    expect(d.refused_ratio).toBe(1);
  });

  it('does not count an accepted send as refused', () => {
    markVerificationOutcome(recordVerificationSend('net-hash', 'acme@example.com'), true);
    const d = verificationDelivery(24);
    expect(d.refused).toBe(0);
    expect(d.refused_ratio).toBe(0);
  });

  it('counts an unknown outcome as attempted but never as refused', () => {
    // A row written before the column existed, or a crash between the two writes.
    recordVerificationSend('net-hash', 'acme@example.com');
    const d = verificationDelivery(24);
    expect(d.attempted).toBe(1);
    expect(d.refused).toBe(0);
  });

  it('ignores an id that never existed rather than touching another row', () => {
    markVerificationOutcome(recordVerificationSend('net-hash', 'acme@example.com'), true);
    markVerificationOutcome(0, false);
    markVerificationOutcome(-1, false);
    expect(verificationDelivery(24).refused).toBe(0);
  });

  it('mixes outcomes into a ratio', () => {
    markVerificationOutcome(recordVerificationSend('n', 'a@example.com'), false);
    markVerificationOutcome(recordVerificationSend('n', 'b@example.com'), false);
    markVerificationOutcome(recordVerificationSend('n', 'c@example.com'), true);
    markVerificationOutcome(recordVerificationSend('n', 'd@example.com'), true);
    expect(verificationDelivery(24).refused_ratio).toBe(0.5);
  });

  it('marks the row it was handed, not a neighbouring one', () => {
    // recordVerificationSend runs two DELETEs after its INSERT. If the id came
    // from anywhere but the INSERT's own result, this would mark the wrong row
    // and quietly corrupt the ratio reported in /health.
    const first = recordVerificationSend('n', 'acme@example.com');
    const second = recordVerificationSend('n', 'ops@alpha.example.net');
    expect(second).toBeGreaterThan(first);
    markVerificationOutcome(second, false);

    const db = getStatsDB();
    const rows = db
      .prepare('SELECT id, relay_accepted FROM verification_sends ORDER BY id')
      .all() as Array<{ id: number; relay_accepted: number | null }>;
    const marked = rows.filter((r) => r.relay_accepted !== null);
    expect(marked).toHaveLength(1);
    expect(marked[0].id).toBe(second);
  });
});

/**
 * The /64 has to survive the way an address is WRITTEN (SEC-05, 2026-09-01).
 *
 * The compressed groups used to be dropped before the first four were taken,
 * so `2001:db8::1` normalised to `2001:db8:1`: two addresses in the same /64
 * landed in two buckets, and one machine changed bucket depending on whether it
 * wrote itself compressed or in full. The cap counted nothing reliable.
 */
describe('normalizeIpForGuard — one bucket per /64, whatever the notation', () => {
  it('puts two addresses of the same /64 in the same bucket', () => {
    expect(normalizeIpForGuard('2001:db8::1')).toBe(normalizeIpForGuard('2001:db8::2'));
    expect(normalizeIpForGuard('2001:db8::1')).toBe('2001:db8:0:0');
  });

  it('gives the compressed and the expanded form of one address the same bucket', () => {
    expect(normalizeIpForGuard('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe(
      normalizeIpForGuard('2001:db8::1'),
    );
  });

  it('keeps different /64s apart', () => {
    expect(normalizeIpForGuard('2001:db8:1::1')).not.toBe(normalizeIpForGuard('2001:db8:2::1'));
    // The counter-example from the audit: a prefix with no compressible zero
    // worked before and must keep working.
    expect(normalizeIpForGuard('2a02:1210:4e2f:1400::5')).toBe(
      normalizeIpForGuard('2a02:1210:4e2f:1400::6'),
    );
    expect(normalizeIpForGuard('2a02:1210:4e2f:1400::5')).toBe('2a02:1210:4e2f:1400');
  });

  it('does NOT collapse IPv4-mapped addresses into one shared bucket', () => {
    // ::ffff:192.0.2.1 is the form Node hands out on a dual-stack socket. Its
    // first four hextets are zeros for EVERY such address, so expanding it
    // would put every IPv4 caller in the world in one bucket and turn a
    // per-source cap into a global one.
    expect(normalizeIpForGuard('::ffff:192.0.2.1')).not.toBe(
      normalizeIpForGuard('::ffff:198.51.100.7'),
    );
    expect(normalizeIpForGuard('::ffff:192.0.2.1')).toBe('192.0.2.1');
  });

  it('ignores a zone index, which names a local interface and not the peer', () => {
    expect(normalizeIpForGuard('fe80::1%eth0')).toBe(normalizeIpForGuard('fe80::1'));
  });
});

describe('la cible d’un défi : un code sait à quoi il sert', () => {
  it('un code émis pour la clé A est refusé pour la clé B, SANS punir la victime', () => {
    const email = `target-${RUN}@alpha-corp.example.net`;
    const code = plant(email, 'src', 'ifk_aaaaaaaa');
    const refused = checkVerificationCode(email, code, 'ifk_bbbbbbbb');
    expect(refused).toEqual({ ok: false, reason: 'wrong_target' });
    // 🚨 Le compteur d'essais n'a pas bougé. Il vit sur une ligne clée par
    // l'ADRESSE seule : un tiers postait cinq codes bidon visant l'adresse
    // d'une victime, chacun comptant un essai, et bloquait son défi en cours
    // jusqu'à expiration. La cible présentée ne prouve RIEN sur le code, donc
    // la compter comme un essai punit la victime et pas l'attaquant.
    const row = getStatsDB()
      .prepare('SELECT attempts FROM pending_verifications WHERE email = ?')
      .get(email) as { attempts: number };
    expect(row.attempts).toBe(0);
    // Et le défi marche toujours pour sa vraie cible.
    expect(checkVerificationCode(email, code, 'ifk_aaaaaaaa')).toEqual({ ok: true });
  });

  it('un défi de CRÉATION (sans cible) est refusé pour une réclamation, et reste bon pour une création', () => {
    const a = `nocible-a-${RUN}@alpha-corp.example.net`;
    const codeA = plant(a, 'src');
    // Sans cette règle, un code émis pour créer une clé était consommable pour
    // en réclamer une autre : rien dans la table ne disait à quoi il servait.
    expect(checkVerificationCode(a, codeA, 'ifk_cccccccc')).toEqual({
      ok: false,
      reason: 'wrong_target',
    });

    // Non-régression stricte du chemin de création : la cible absente des deux
    // côtés, le comportement est celui d'avant, octet pour octet.
    const b = `nocible-b-${RUN}@alpha-corp.example.net`;
    const codeB = plant(b, 'src');
    expect(checkVerificationCode(b, codeB)).toEqual({ ok: true });
  });

  it('un défi vivant qui vise une autre clé n’est pas écrasé avant la grâce, et l’est après', () => {
    const email = `grace-${RUN}@alpha-corp.example.net`;
    const first = plant(email, 'src', 'ifk_dddddddd');
    // Dans la fenêtre : refus. Son destinataire est peut-être en train de
    // recopier ses six chiffres, et sur la réclamation l'écrasement est infligé
    // par un TIERS.
    expect(createVerificationChallenge(email, 'src', 'ifk_eeeeeeee')).toEqual({
      refused: 'in_flight',
    });
    expect(checkVerificationCode(email, first, 'ifk_dddddddd')).toEqual({ ok: true });

    // Au-delà de la grâce : l'écrasement reprend. Refuser toujours donnerait à
    // n'importe quel porteur de clé le moyen de verrouiller une adresse
    // pendant toute la durée de vie du code.
    const again = plant(email, 'src', 'ifk_dddddddd');
    getStatsDB()
      .prepare(`UPDATE pending_verifications SET created_at = datetime('now', ?) WHERE email = ?`)
      .run(`-${CHALLENGE_GRACE_MINUTES + 1} minutes`, email);
    const third = plant(email, 'src', 'ifk_eeeeeeee');
    expect(third).not.toBe(again);
    expect(checkVerificationCode(email, third, 'ifk_eeeeeeee')).toEqual({ ok: true });
  });

  it('le même défi réémis pour la MÊME cible n’est jamais refusé', () => {
    const email = `same-${RUN}@alpha-corp.example.net`;
    plant(email, 'src', 'ifk_ffffffff');
    const second = plant(email, 'src', 'ifk_ffffffff');
    expect(checkVerificationCode(email, second, 'ifk_ffffffff')).toEqual({ ok: true });
  });
});

describe('le budget d’envoi se compte par BOÎTE, pas par écriture d’adresse', () => {
  it('une étiquette et des points partagent le même budget chez gmail', () => {
    // Sans normalisation, you+1@, you+2@ et y.o.u@ sont trois destinataires
    // pour le compteur et une seule boîte pour leur porteur : le plafond par
    // destinataire se multipliait à volonté.
    const src = `send-alias-${RUN}`;
    const plain = `budget${RUN}@gmail.com`;
    const tagged = `budget${RUN}+ci@gmail.com`;
    const dotted = `b.u.d.g.e.t${RUN}@gmail.com`;
    for (const e of [plain, tagged, dotted].slice(0, VERIFICATION_SENDS_PER_EMAIL_DAY)) {
      expect(challengeSendAllowed(src, e).ok).toBe(true);
      recordVerificationSend(src, e);
    }
    const check = challengeSendAllowed(src, plain);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toBe('recipient');
    // Et l'alias non plus : c'est la même boîte.
    expect(challengeSendAllowed(src, dotted).ok).toBe(false);
  });

  it('une adresse ordinaire garde exactement le budget d’avant', () => {
    // Non-régression : hors gmail et sans étiquette, la valeur hachée est
    // identique à celle de la version précédente, donc les compteurs déjà en
    // base gardent leur sens.
    const src = `send-plain-${RUN}`;
    const email = `plain-${RUN}@alpha-corp.example.net`;
    expect(challengeSendAllowed(src, email).ok).toBe(true);
    recordVerificationSend(src, email);
    expect(challengeSendAllowed(src, `PLAIN-${RUN}@Alpha-Corp.Example.Net`).ok).toBe(true);
  });
});

describe('la parité des deux portes', () => {
  it('le plafond de réclamations par réseau est le plafond de créations, pas un réglage à part', () => {
    // 🚨 Ce n'est pas une coïncidence à documenter, c'est une égalité à FIGER :
    // le critère d'acceptation de la réclamation est la parité avec la
    // création. Un chiffre à part dériverait le jour où l'un des deux bouge, et
    // la réclamation redeviendrait plus généreuse sur l'axe même que les deux
    // fermes d'août ont payé.
    expect(CLAIM_SUCCESS_PER_SOURCE_DAY).toBe(DAILY_KEY_CREATION_LIMIT);
  });
});
