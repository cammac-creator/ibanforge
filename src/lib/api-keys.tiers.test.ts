import { describe, expect, it } from 'vitest';
import {
  claimKey,
  generateApiKey,
  getKeyTier,
  getUsage,
  rotateApiKey,
  validateApiKey,
} from './api-keys.js';
import { ANONYMOUS_CONTACT, ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from './tiers.js';
import { getStatsDB } from './db.js';

/**
 * Le palier de clé au niveau de la bibliothèque (spec 01 §6.1, cas 1 à 11).
 * Les routes viennent au lot 3 ; ici on prouve que la donnée dit la vérité.
 * Fixtures inventées : ce dépôt est public.
 */
const RUN = Date.now();
let seq = 0;
const addr = (tag: string) => `${tag}-${RUN}-${seq++}@alpha.example.net`;

function anon(ipHash = `tiers-${RUN}`) {
  const k = generateApiKey(null, undefined, undefined, false, { ipHash, userAgent: 'curl/8.7.1' });
  if (!k) throw new Error('mint failed');
  return k;
}

function column<T>(keyHash: string, col: string): T {
  const row = getStatsDB()
    .prepare(`SELECT ${col} AS v FROM api_keys WHERE key_hash = ?`)
    .get(keyHash) as { v: T };
  return row.v;
}

describe('palier anonyme, en base', () => {
  it('1. une clé sans adresse naît anonyme, à 25, sous la sentinelle, sans forme normalisée', () => {
    const k = anon();
    expect(column(k.key_hash, 'tier')).toBe('anonymous');
    expect(column(k.key_hash, 'monthly_limit')).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(column(k.key_hash, 'email')).toBe(ANONYMOUS_CONTACT);
    expect(column(k.key_hash, 'email_norm')).toBeNull();
    expect(column(k.key_hash, 'claimed_at')).toBeNull();
  });

  it('2. deux clés anonymes le même jour sont deux clés distinctes (le piège de la sentinelle partagée)', () => {
    const a = anon();
    const b = anon();
    expect(a.key_prefix).not.toBe(b.key_prefix);
  });

  it('3. la même adresse deux fois le même jour rend null la seconde fois : comportement préservé', () => {
    const e = addr('same');
    expect(generateApiKey(e)).not.toBeNull();
    expect(generateApiKey(e)).toBeNull();
  });

  it('4. la garde du jour porte sur la forme normalisée : étiquette et points chez gmail', () => {
    const local = `you.${RUN}.${seq++}`;
    expect(generateApiKey(`${local}+1@gmail.com`)).not.toBeNull();
    expect(generateApiKey(`${local.split('.').join('')}@googlemail.com`)).toBeNull();
    const corp = `you-${RUN}-${seq++}`;
    expect(generateApiKey(`${corp}@company.example.net`)).not.toBeNull();
    expect(generateApiKey(`${corp}+ci@company.example.net`)).toBeNull();
  });

  it('5. validateApiKey lit le palier et le plafond de 25', () => {
    const k = anon();
    const v = validateApiKey(k.api_key);
    expect(v.valid).toBe(true);
    expect(v.tier).toBe('anonymous');
    expect(v.monthlyLimit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(v.email).toBe(ANONYMOUS_CONTACT);
  });

  it('6. la rotation d’une clé anonyme garde le palier et le plafond', () => {
    const k = anon();
    const r = rotateApiKey(k.api_key)!;
    expect(r.tier).toBe('anonymous');
    expect(r.monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(column(r.key_hash, 'tier')).toBe('anonymous');
    expect(column(r.key_hash, 'origin_prefix')).toBe(k.key_prefix);
    expect(validateApiKey(k.api_key).valid).toBe(false);
  });
});

describe('réclamation, par hash', () => {
  it('8. claimKey deux fois : true puis false, une seule claimed_at', () => {
    const k = anon();
    expect(claimKey(k.key_hash, 'email_code', { email: addr('claim') })).toBe(true);
    const at = column<string>(k.key_hash, 'claimed_at');
    expect(at).not.toBeNull();
    expect(claimKey(k.key_hash, 'email_code', { email: addr('claim') })).toBe(false);
    expect(column(k.key_hash, 'claimed_at')).toBe(at);
    const journal = (
      getStatsDB()
        .prepare("SELECT COUNT(*) AS n FROM key_claims WHERE key_hash = ? AND event = 'claim'")
        .get(k.key_hash) as { n: number }
    ).n;
    expect(journal).toBe(1);
  });

  it('9. claimKey sur une clé née avec adresse : false, rien modifié', () => {
    const k = generateApiKey(addr('email-tier'))!;
    const before = getKeyTier(k.key_hash)!;
    expect(claimKey(k.key_hash, 'email_code')).toBe(false);
    expect(getKeyTier(k.key_hash)).toEqual(before);
  });

  it('10. le code vérifié EFFACE no_recredit ; un paiement le POSE (200 une fois)', () => {
    const a = anon();
    getStatsDB()
      .prepare("UPDATE api_keys SET no_recredit = 1, shield_episode = 'ep-1' WHERE key_hash = ?")
      .run(a.key_hash);
    expect(claimKey(a.key_hash, 'email_code', { email: addr('mailbox') })).toBe(true);
    const ra = getKeyTier(a.key_hash)!;
    expect(ra.tier).toBe('claimed');
    expect(ra.no_recredit).toBe(0);
    expect(ra.shield_episode).toBeNull();
    expect(ra.monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    // L'adresse prouvée remplace la sentinelle, et sa forme normalisée est posée.
    expect(column(a.key_hash, 'email')).not.toBe(ANONYMOUS_CONTACT);
    expect(column(a.key_hash, 'email_norm')).not.toBeNull();

    const b = anon();
    expect(claimKey(b.key_hash, 'x402')).toBe(true);
    const rb = getKeyTier(b.key_hash)!;
    expect(rb.tier).toBe('paid');
    expect(rb.no_recredit).toBe(1);
    expect(rb.monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    // Un rail payant ne pose aucune adresse : la clé reste hors CRM et hors mails.
    expect(column(b.key_hash, 'email')).toBe(ANONYMOUS_CONTACT);
  });

  it('7. la rotation d’une clé réclamée porte tout : palier, preuve, adresse normalisée, no_recredit', () => {
    const k = anon();
    claimKey(k.key_hash, 'x402');
    const before = getKeyTier(k.key_hash)!;
    const r = rotateApiKey(k.api_key)!;
    const after = getKeyTier(r.key_hash)!;
    expect(after.tier).toBe(before.tier);
    expect(after.monthly_limit).toBe(before.monthly_limit);
    expect(after.claimed_at).toBe(before.claimed_at);
    expect(after.claim_method).toBe(before.claim_method);
    expect(after.no_recredit).toBe(before.no_recredit);
    expect(column(r.key_hash, 'email_norm')).toBe(column(k.key_hash, 'email_norm'));
  });

  it('11. getUsage mesure la somme de vie sur une clé hors du reset mensuel', () => {
    const k = anon();
    const db = getStatsDB();
    db.prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)').run(
      k.key_hash,
      '2026-07',
      7,
    );
    db.prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)').run(
      k.key_hash,
      '2026-08',
      11,
    );
    expect(getUsage(k.key_hash, 25, false).used).toBe(0);
    const life = getUsage(k.key_hash, 25, true);
    expect(life.used).toBe(18);
    expect(life.remaining).toBe(7);
  });
});
