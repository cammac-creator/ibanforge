import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStatsDB } from './db.js';
import { generateApiKey, claimKey, rotateApiKey, generateCreditKey } from './api-keys.js';
import { recordKeySettlement } from './key-settlements.js';
import {
  normalizeLineageContext,
  recordLineageSuccess,
  resetLineageDayCache,
  purgeLineageFacts,
} from './lineage-facts.js';
import { isBillableCall } from './stats.js';

/**
 * L'enregistreur de faits de lignée : ce qu'il compte, ce qu'il ignore, et ce
 * qu'il n'écrit qu'une fois. Fixtures inventées, ce dépôt est public.
 */
const RUN = Date.now();
let n = 0;

/** Une lignée neuve, anonyme, avec son ancre de naissance. */
function freshLineage(): { api_key: string; key_hash: string; key_prefix: string } {
  n += 1;
  const key = generateApiKey(null, undefined, undefined, false, { ipHash: `lf-${RUN}-${n}` });
  if (!key) throw new Error('clé non frappée');
  return key;
}

function factOf(lineage: string) {
  return getStatsDB().prepare('SELECT * FROM lineage_facts WHERE lineage_hash = ?').get(lineage) as
    Record<string, unknown> | undefined;
}

function callOk(keyHash: string, context?: string, path = '/v1/iban/validate') {
  recordLineageSuccess({ keyHash, method: 'POST', path, status: 200, context });
}

beforeEach(() => {
  resetLineageDayCache();
});

afterEach(() => {
  vi.useRealTimers();
  resetLineageDayCache();
});

describe('le marqueur de contexte', () => {
  it("n'accepte que `demo` ; tout le reste vaut `unknown`", () => {
    expect(normalizeLineageContext('demo')).toBe('demo');
    expect(normalizeLineageContext(' DEMO ')).toBe('demo');
    expect(normalizeLineageContext('production')).toBe('unknown');
    expect(normalizeLineageContext(undefined)).toBe('unknown');
    expect(normalizeLineageContext('')).toBe('unknown');
  });
});

describe('le filtre métier', () => {
  it('reconnaît les cinq familles sur la route NORMALISÉE', () => {
    expect(isBillableCall('POST', '/v1/iban/validate')).toBe(true);
    expect(isBillableCall('post', '/v1/iban/batch')).toBe(true);
    expect(isBillableCall('POST', '/v1/iban/compliance')).toBe(true);
    expect(isBillableCall('GET', '/v1/bic/DEUTDEFF')).toBe(true);
    expect(isBillableCall('GET', '/v1/ch/clearing/230')).toBe(true);
  });

  it('refuse un simple PRÉFIXE textuel, un mauvais verbe et une route libre', () => {
    // Le contrat interdit de reconnaître une route à son seul préfixe.
    expect(isBillableCall('GET', '/v1/bic/aa/bb')).toBe(false);
    expect(isBillableCall('POST', '/v1/iban/validateXY')).toBe(false);
    expect(isBillableCall('GET', '/v1/iban/validate')).toBe(false);
    expect(isBillableCall('POST', '/v1/keys/generate')).toBe(false);
    expect(isBillableCall('GET', '/health')).toBe(false);
    expect(isBillableCall('GET', '/v1')).toBe(false);
    // Un gabarit OpenAPI non substitué n'est pas du trafic métier.
    expect(isBillableCall('GET', '/v1/bic/%7Bcode%7D')).toBe(false);
  });
});

describe("l'enregistreur de succès", () => {
  it('deux succès identiques ne posent qu’UN premier', () => {
    const k = freshLineage();
    callOk(k.key_hash);
    const first = factOf(k.key_hash)!;
    resetLineageDayCache();
    callOk(k.key_hash);
    const again = factOf(k.key_hash)!;
    expect(again.first_success_at).toBe(first.first_success_at);
    expect(again.first_success_route).toBe('POST /v1/iban/validate');
    expect(again.first_success_context).toBe('unknown');
    // Le même jour UTC : un seul jour actif, même après vidage du cache.
    expect(again.success_days).toBe(1);
  });

  it('un 4xx, un 5xx et une route non métier sont ignorés', () => {
    const k = freshLineage();
    recordLineageSuccess({
      keyHash: k.key_hash,
      method: 'POST',
      path: '/v1/iban/validate',
      status: 400,
      context: undefined,
    });
    recordLineageSuccess({
      keyHash: k.key_hash,
      method: 'POST',
      path: '/v1/iban/validate',
      status: 500,
      context: undefined,
    });
    recordLineageSuccess({
      keyHash: k.key_hash,
      method: 'POST',
      path: '/v1/keys/generate',
      status: 200,
      context: undefined,
    });
    expect(factOf(k.key_hash)!.first_success_at).toBeNull();
  });

  it('un IBAN invalide dans le corps reste un succès technique', () => {
    // Le service a répondu 200 : `valid: false` ne supprime pas le succès.
    const k = freshLineage();
    callOk(k.key_hash);
    expect(factOf(k.key_hash)!.first_success_at).not.toBeNull();
  });

  it('un lot de plusieurs IBAN compte pour UNE activation', () => {
    const k = freshLineage();
    callOk(k.key_hash, undefined, '/v1/iban/batch');
    const f = factOf(k.key_hash)!;
    expect(f.first_success_route).toBe('POST /v1/iban/batch');
    expect(f.success_days).toBe(1);
  });

  it('`demo` puis sans marqueur : le hors-panneau est posé au SECOND', () => {
    const k = freshLineage();
    callOk(k.key_hash, 'demo');
    const shown = factOf(k.key_hash)!;
    expect(shown.first_success_context).toBe('demo');
    expect(shown.first_unmarked_success_at).toBeNull();
    // Même jour, même lignée, contexte différent : l'écriture passe.
    callOk(k.key_hash, undefined);
    const after = factOf(k.key_hash)!;
    expect(after.first_success_context).toBe('demo');
    expect(after.first_unmarked_success_at).not.toBeNull();
    // Et le jour n'est compté qu'une fois, malgré les deux écritures.
    expect(after.success_days).toBe(1);
  });

  it('un changement de jour UTC porte les jours actifs à 2', () => {
    const k = freshLineage();
    callOk(k.key_hash);
    expect(factOf(k.key_hash)!.success_days).toBe(1);
    // Le lendemain, en base : on déplace la trace du dernier jour compté, ce
    // qui est exactement ce que voit le code au passage de minuit UTC.
    getStatsDB()
      .prepare("UPDATE lineage_facts SET last_success_day = '2000-01-01' WHERE lineage_hash = ?")
      .run(k.key_hash);
    resetLineageDayCache();
    callOk(k.key_hash);
    expect(factOf(k.key_hash)!.success_days).toBe(2);
  });

  it('une clé TOURNÉE alimente la MÊME lignée', () => {
    const k = freshLineage();
    callOk(k.key_hash);
    const rotated = rotateApiKey(k.api_key);
    expect(rotated).not.toBeNull();
    expect(rotated!.key_hash).not.toBe(k.key_hash);
    resetLineageDayCache();
    callOk(rotated!.key_hash);
    // Aucune lignée neuve : la clé tournée écrit sur la lignée d'origine.
    expect(factOf(rotated!.key_hash)).toBeUndefined();
    const f = factOf(k.key_hash)!;
    expect(f.last_success_at).not.toBeNull();
    expect(f.success_days).toBe(1);
  });

  it('une clé inconnue n’invente aucune lignée', () => {
    callOk(`h-inconnue-${RUN}`);
    expect(factOf(`h-inconnue-${RUN}`)).toBeUndefined();
  });

  it('le retour de deuxième semaine ne se pose QUE dans la fenêtre', () => {
    const k = freshLineage();
    callOk(k.key_hash);
    const db = getStatsDB();
    // Le premier succès daté d'il y a 20 jours, et le dernier jour compté
    // remis en arrière pour que l'écriture suivante passe.
    db.prepare(
      `UPDATE lineage_facts
          SET first_success_at = datetime('now', '-20 days'), last_success_day = '2000-01-01'
        WHERE lineage_hash = ?`,
    ).run(k.key_hash);
    resetLineageDayCache();
    callOk(k.key_hash);
    // 20 jours après le premier succès : hors de [ +7 j, +14 j [.
    expect(factOf(k.key_hash)!.week2_success_at).toBeNull();

    db.prepare(
      `UPDATE lineage_facts
          SET first_success_at = datetime('now', '-8 days'), last_success_day = '2000-01-01'
        WHERE lineage_hash = ?`,
    ).run(k.key_hash);
    resetLineageDayCache();
    callOk(k.key_hash);
    // 8 jours après : dans la fenêtre, donc posé.
    expect(factOf(k.key_hash)!.week2_success_at).not.toBeNull();
    const posed = factOf(k.key_hash)!.week2_success_at;

    // Et il ne se réécrit pas.
    db.prepare(
      "UPDATE lineage_facts SET last_success_day = '2000-01-01' WHERE lineage_hash = ?",
    ).run(k.key_hash);
    resetLineageDayCache();
    callOk(k.key_hash);
    expect(factOf(k.key_hash)!.week2_success_at).toBe(posed);
  });
});

describe('réclamation et règlement', () => {
  it('une réclamation pose son premier une seule fois', () => {
    const k = freshLineage();
    expect(claimKey(k.key_hash, 'email_code', { email: `lf-${RUN}-c@alpha.example.net` })).toBe(
      true,
    );
    const f = factOf(k.key_hash)!;
    expect(f.first_claim_at).not.toBeNull();
    expect(f.claim_method).toBe('email_code');
    // Second appel : le WHERE tier = 'anonymous' ne retient plus rien.
    expect(claimKey(k.key_hash, 'x402')).toBe(false);
    expect(factOf(k.key_hash)!.claim_method).toBe('email_code');
    expect(factOf(k.key_hash)!.first_claim_at).toBe(f.first_claim_at);
  });

  it("un règlement rejoué ne compte qu'une fois", () => {
    const k = freshLineage();
    const ref = `lf-ref-${RUN}-${n}`;
    expect(
      recordKeySettlement({
        keyHash: k.key_hash,
        keyPrefix: k.key_prefix,
        paymentRef: ref,
        route: 'POST /v1/iban/validate',
        quotedAmountUsd: 0.005,
      }),
    ).toBe(true);
    const f = factOf(k.key_hash)!;
    expect(f.first_settlement_at).not.toBeNull();
    expect(f.settlement_count).toBe(1);
    // Même référence : l'INSERT OR IGNORE n'insère rien, donc rien ne monte.
    expect(
      recordKeySettlement({
        keyHash: k.key_hash,
        keyPrefix: k.key_prefix,
        paymentRef: ref,
        route: 'POST /v1/iban/validate',
        quotedAmountUsd: 0.005,
      }),
    ).toBe(false);
    expect(factOf(k.key_hash)!.settlement_count).toBe(1);
    expect(factOf(k.key_hash)!.first_settlement_at).toBe(f.first_settlement_at);
  });
});

describe('la clé payée reliée à une lignée', () => {
  it("se relie quand l'adresse est vérifiée et la correspondance unique", () => {
    const address = `lf-${RUN}-paid@alpha.example.net`;
    const trial = freshLineage();
    claimKey(trial.key_hash, 'email_code', { email: address });
    const paid = generateCreditKey(address, 1_000, `lf-pay-${RUN}-${n}`);
    const f = factOf(trial.key_hash)!;
    expect(f.paid_key_hash).not.toBeNull();
    expect(f.paid_key_delivered_at).not.toBeNull();

    // Le premier usage de la clé PAYÉE se lit sur la lignée qui a acheté.
    const paidHash = getStatsDB()
      .prepare('SELECT key_hash FROM api_keys WHERE key_prefix = ?')
      .get(paid.key_prefix) as { key_hash: string };
    resetLineageDayCache();
    callOk(paidHash.key_hash);
    expect(factOf(trial.key_hash)!.paid_first_success_at).not.toBeNull();
  });

  it('ne relie RIEN quand deux lignées portent la même adresse', () => {
    const address = `lf-${RUN}-ambig@alpha.example.net`;
    const a = freshLineage();
    const b = freshLineage();
    claimKey(a.key_hash, 'email_code', { email: address });
    claimKey(b.key_hash, 'email_code', { email: address });
    generateCreditKey(address, 1_000, `lf-pay-amb-${RUN}-${n}`);
    expect(factOf(a.key_hash)!.paid_key_hash).toBeNull();
    expect(factOf(b.key_hash)!.paid_key_hash).toBeNull();
  });

  it('ne relie RIEN sans adresse réelle, ni sur une lignée non réclamée', () => {
    const unclaimed = freshLineage();
    // Sans adresse : le placeholder `credits-buyer` ne relie personne.
    generateCreditKey(null, 1_000, `lf-pay-none-${RUN}-${n}`);
    expect(factOf(unclaimed.key_hash)!.paid_key_hash).toBeNull();
  });
});

describe('rétention', () => {
  it('ne supprime que les lignées éteintes et vieilles de plus de douze mois', () => {
    const db = getStatsDB();
    const live = freshLineage();
    const dead = freshLineage();
    db.prepare('UPDATE api_keys SET active = 0 WHERE key_hash = ?').run(dead.key_hash);
    db.prepare(
      "UPDATE lineage_facts SET birth_at = datetime('now', '-13 months') WHERE lineage_hash IN (?, ?)",
    ).run(live.key_hash, dead.key_hash);
    purgeLineageFacts(12);
    // La clé active survit malgré son âge : c'est un porteur vivant.
    expect(factOf(live.key_hash)).toBeDefined();
    expect(factOf(dead.key_hash)).toBeUndefined();
  });
});
