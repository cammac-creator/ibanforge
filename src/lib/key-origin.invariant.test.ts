import { describe, expect, it } from 'vitest';
import {
  generateApiKey,
  generateCreditKey,
  generateOemKey,
  generateStripeKey,
  rotateApiKey,
} from './api-keys.js';
import { getStatsDB } from './db.js';
import { isDoorOrigin, ORIGIN_SHAPE } from './key-origins.js';

/**
 * L'invariant d'origine : aucune clé ne naît muette sur sa porte.
 *
 * Une origine ne se rattrape JAMAIS après coup — rien d'autre sur la ligne ne
 * dit par où la clé est entrée, et la deviner depuis le palier ou le domaine
 * de l'adresse inventerait un fait. Chaque fonction de frappe doit donc écrire
 * une valeur, et ce test la lit en base plutôt que de croire une signature :
 * un défaut de paramètre ajouté sans toucher à l'INSERT ne se verrait pas
 * autrement.
 *
 * 🚨 Il couvre les QUATRE fonctions de frappe, pas seulement celle de la route
 * publique. Les trois rails payants écrivaient NULL et personne ne le voyait :
 * c'est exactement la porte qu'on ne peut pas juger quand un premier
 * abonnement arrive.
 *
 * Fixtures inventées : ce dépôt est public.
 */
const RUN = Date.now();

function sourceOf(keyPrefix: string): string | null {
  return (
    getStatsDB().prepare('SELECT source FROM api_keys WHERE key_prefix = ?').get(keyPrefix) as {
      source: string | null;
    }
  ).source;
}

function birthSourceOf(keyPrefix: string): string | null {
  const row = getStatsDB()
    .prepare(
      `SELECT f.birth_source AS s
         FROM lineage_facts f
         JOIN api_keys k ON k.lineage_hash = f.lineage_hash
        WHERE k.key_prefix = ?`,
    )
    .get(keyPrefix) as { s: string | null } | undefined;
  return row?.s ?? null;
}

describe('invariant d’origine — chaque chemin de frappe écrit une porte', () => {
  it('clé libre : l’origine passée par la route est écrite telle quelle', () => {
    const k = generateApiKey(`origin-free-${RUN}@alpha.example.net`, undefined, 'site-pricing');
    expect(k).not.toBeNull();
    expect(sourceOf(k!.key_prefix)).toBe('site-pricing');
    expect(birthSourceOf(k!.key_prefix)).toBe('site-pricing');
  });

  it('paquet x402 : la porte par défaut du rail, sans que l’appelant la nomme', () => {
    const k = generateCreditKey(`origin-x402-${RUN}@alpha.example.net`, 1000);
    expect(sourceOf(k.key_prefix)).toBe('x402-pack');
    expect(birthSourceOf(k.key_prefix)).toBe('x402-pack');
  });

  it('paquet par carte : la porte par défaut du rail', () => {
    const k = generateStripeKey(`origin-pack-${RUN}@alpha.example.net`, 1000, `cs_test_${RUN}`);
    expect(k.idempotent).toBe(false);
    expect(sourceOf(k.key_prefix)).toBe('stripe-pack');
    expect(birthSourceOf(k.key_prefix)).toBe('stripe-pack');
  });

  it('abonnement par carte : la porte par défaut du rail', () => {
    const k = generateOemKey(
      `origin-sub-${RUN}@alpha.example.net`,
      10_000,
      `cs_sub_${RUN}`,
      `sub_${RUN}`,
    );
    expect(k.idempotent).toBe(false);
    expect(sourceOf(k.key_prefix)).toBe('stripe-subscription');
    expect(birthSourceOf(k.key_prefix)).toBe('stripe-subscription');
  });

  it('les quatre rails écrivent une valeur stockable, et une porte connue', () => {
    // Le garde-fou qui attrape le prochain rail ajouté : une valeur qui ne
    // passe pas ORIGIN_SHAPE serait refusée par la route publique et une valeur
    // hors vocabulaire s'afficherait sur le tableau de bord sans appartenir à
    // aucune porte.
    const prefixes = [
      generateCreditKey(`origin-shape-a-${RUN}@alpha.example.net`, 1000).key_prefix,
      generateStripeKey(`origin-shape-b-${RUN}@alpha.example.net`, 1000, `cs_shape_${RUN}`)
        .key_prefix,
      generateOemKey(`origin-shape-c-${RUN}@alpha.example.net`, 10_000, `cs_shape_sub_${RUN}`, null)
        .key_prefix,
      generateApiKey(`origin-shape-d-${RUN}@alpha.example.net`, undefined, 'admin')!.key_prefix,
    ];
    for (const prefix of prefixes) {
      const source = sourceOf(prefix);
      expect(source, prefix).not.toBeNull();
      expect(ORIGIN_SHAPE.test(source!), `${prefix} → ${source}`).toBe(true);
      expect(isDoorOrigin(source), `${prefix} → ${source}`).toBe(true);
    }
  });

  it('la rotation garde l’origine de la clé d’avant', () => {
    // 🚨 Une clé tournée n'est pas une nouvelle acquisition : elle vient de la
    // même porte. La recopier ici est ce qui empêche une rotation de faire
    // disparaître un canal du décompte.
    const k = generateApiKey(`origin-rot-${RUN}@alpha.example.net`, undefined, 'n8n');
    expect(k).not.toBeNull();
    const rotated = rotateApiKey(k!.api_key);
    expect(rotated).not.toBeNull();
    expect(sourceOf(rotated!.key_prefix)).toBe('n8n');
  });
});
