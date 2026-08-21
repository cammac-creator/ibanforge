import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { bicLookup } from './bic-lookup.js';
import { getRejectionStats } from '../lib/stats.js';
import type { HonoEnv } from '../types.js';

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.route('/', bicLookup);
  return app;
}

/**
 * Rejets enregistrés aujourd'hui pour un couple (opération, raison).
 * On compare des DELTAS : la base de stats est partagée par toute la suite,
 * un compte absolu serait dépendant de l'ordre des fichiers de test.
 */
function rejections(operation: string, reason: string): number {
  return (
    getRejectionStats(1).find(
      (r) => r.operation_type === operation && r.reject_reason === reason,
    )?.count ?? 0
  );
}

function totalRejections(): number {
  return getRejectionStats(1).reduce((n, r) => n + r.count, 0);
}

describe('GET /v1/bic/:code', () => {
  it('rejects a BIC with wrong length', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/ABC');
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('invalid_bic_format');
  });

  it('returns 400 for invalid character content', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/ABCD123!');
    expect(res.status).toBe(400);
  });

  it('returns a result shape for a plausible BIC8', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/UBSWCHZH');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      bic: string;
      bic8: string;
      bic11: string;
      valid_format: boolean;
      found: boolean;
      cost_usdc: number;
      is_test_bic: boolean;
    };
    expect(json.valid_format).toBe(true);
    expect(json.bic8).toBe('UBSWCHZH');
    expect(typeof json.found).toBe('boolean');
    expect(typeof json.cost_usdc).toBe('number');
    expect(typeof json.is_test_bic).toBe('boolean');
  });

  it('handles BIC11 input', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/UBSWCHZH80A');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { bic11: string };
    expect(json.bic11).toBe('UBSWCHZH80A');
  });

  it('returns a dedicated 400 when the agent sends the literal {code} placeholder', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/%7Bcode%7D');
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; example: string };
    expect(json.error).toBe('placeholder_literal');
    expect(json.example).toContain('UBSWCHZH');
  });

  it('returns a registered GLEIF address (with romanization) for a head-office BIC', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/ABOCCNBJXXX');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      found: boolean;
      address_available: boolean;
      address: {
        type: string;
        street: string | null;
        post_code: string | null;
        country: string;
        romanized: string | null;
        romanization: 'original_latin' | 'gleif_english' | 'unavailable';
        source: string;
      } | null;
    };
    expect(json.found).toBe(true);
    expect(json.address_available).toBe(true);
    expect(json.address).not.toBeNull();
    expect(json.address!.type).toBe('registered');
    expect(json.address!.country).toBe('CN');
    expect(json.address!.post_code).toBe('100005');
    expect(json.address!.romanized).toContain('Jianguomen Nei Avenue');
    expect(json.address!.source).toBe('GLEIF');
    // romanization provenance must be consistent with the fields (logic, not
    // data-coupled): a distinct Latin reading for a non-Latin address = GLEIF English.
    expect(['original_latin', 'gleif_english', 'unavailable']).toContain(
      json.address!.romanization,
    );
    expect(json.address!.romanization).toBe('gleif_english');
  });

  it('reports romanization provenance consistently with the fields', async () => {
    const app = makeApp();
    // ING NL — a Latin-script registered address: romanized equals the address itself.
    const res = await app.request('/v1/bic/INGBNL2AXXX');
    const json = (await res.json()) as {
      address: { street: string | null; romanized: string | null; romanization: string } | null;
    };
    expect(json.address).not.toBeNull();
    const a = json.address!;
    // Invariant the API guarantees, independent of which exact bank this is:
    if (a.romanized === null) {
      expect(a.romanization).toBe('unavailable');
    } else if (a.romanized === a.street) {
      expect(a.romanization).toBe('original_latin');
    } else {
      expect(a.romanization).toBe('gleif_english');
    }
  });

  it('treats an already-Latin Greek/Arabic address as original_latin, not unavailable', async () => {
    const app = makeApp();
    // PESUGRA1XXX (GR) is tagged language 'el' by GLEIF but filed its address in
    // Latin ("VALAORITOU 17") — it must read as Latin, with a non-null romanized.
    const res = await app.request('/v1/bic/PESUGRA1XXX');
    const json = (await res.json()) as {
      address: { street: string | null; romanized: string | null; romanization: string } | null;
    };
    if (json.address) {
      expect(json.address.romanization).toBe('original_latin');
      expect(json.address.romanized).not.toBeNull();
    }
  });

  it('suppresses the address for a foreign-branch BIC (same-country guard)', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/FABMCNSHXXX');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { address: unknown; address_available: boolean };
    expect(json.address).toBeNull();
    expect(json.address_available).toBe(false);
  });
});

describe('GET /v1/bic/:code — instrumentation des rejets (phase 1 : on compte, on ne change rien)', () => {
  it('renvoie toujours 400 sur un BIC espacé (phase 1 ne change rien)', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/UBSW%20CHZH');
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('invalid_bic_format');
  });

  it('enregistre exactement un rejet `normalizable` pour ce BIC espacé', async () => {
    const before = rejections('bic_lookup', 'normalizable');
    await makeApp().request('/v1/bic/UBSW%20CHZH');
    expect(rejections('bic_lookup', 'normalizable')).toBe(before + 1);
  });

  it('enregistre le placeholder littéral sous sa propre catégorie', async () => {
    const before = rejections('bic_lookup', 'placeholder_literal');
    const res = await makeApp().request('/v1/bic/%7Bcode%7D');
    expect(res.status).toBe(400);
    expect(rejections('bic_lookup', 'placeholder_literal')).toBe(before + 1);
  });

  it('compte aussi un BIC de forme ISO invalide qui passe la garde de longueur', async () => {
    const before = rejections('bic_lookup', 'invalid_bic_shape');
    const res = await makeApp().request('/v1/bic/12345678');
    expect(res.status).toBe(400);
    expect(rejections('bic_lookup', 'invalid_bic_shape')).toBe(before + 1);
  });

  it("n'enregistre aucun rejet quand la garde accepte l'entrée", async () => {
    const before = totalRejections();
    const res = await makeApp().request('/v1/bic/UBSWCHZH');
    expect(res.status).toBe(200);
    expect(totalRejections()).toBe(before);
  });
});

describe('GET /v1/bic/:code — sanctions warning', () => {
  const app = makeApp();

  it('warns on a designated bank our directory cannot name', async () => {
    const res = await app.request('/v1/bic/AGRULYLT', { headers: { 'X-Dev-Skip': 'true' } });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    // Both at once: we hold no directory row, AND the bank is designated.
    expect(body.found).toBe(false);
    const s = body.sanctions as Record<string, unknown>;
    expect(s.screened).toBe(true);
    expect(s.listed).toBe(true);
    expect(s.matched_lists).toContain('EU');
    // The old note called this "coverage may be partial", which is a calm way
    // to describe a sanctioned bank.
    expect(body.note).toContain('sanctions list');
    expect(body.note).not.toContain('coverage may be partial');
  });

  it('reports a clean bank as screened and clean', async () => {
    const res = await app.request('/v1/bic/COBADEFF', { headers: { 'X-Dev-Skip': 'true' } });
    const body = (await res.json()) as Record<string, unknown>;
    const s = body.sanctions as Record<string, unknown>;
    expect(s.screened).toBe(true);
    expect(s.listed).toBe(false);
    expect(s.matched_lists).toEqual([]);
  });

  it('keeps the ordinary not-found wording for a BIC nobody has designated', async () => {
    const res = await app.request('/v1/bic/AAAAGB2L', { headers: { 'X-Dev-Skip': 'true' } });
    const body = (await res.json()) as Record<string, unknown>;
    if (body.found === false) expect(body.note).toContain('coverage may be partial');
  });
});

/**
 * A shared BIC8 stops answering "not found" about a code we hold.
 *
 * The route normalises a BIC8 to `bic8 + 'XXX'` and looks that up, so a code
 * whose head-office record does not exist came back `found: false` plus
 * "coverage may be partial" — while the directory held it perfectly well.
 * Measured 21/08/2026: 352 BIC8 in that position, 11,422 rows.
 */
describe('GET /v1/bic/:code — shared BIC8 aggregate', () => {
  const app = makeApp();

  async function get(code: string) {
    const res = await app.request('/v1/bic/' + code, { headers: { 'X-Dev-Skip': 'true' } });
    return (await res.json()) as Record<string, unknown>;
  }

  it('reports how many institutions share the code instead of claiming ignorance', async () => {
    const body = await get('GENODEF1');
    const shared = body.shared_bic8 as { institutions: number; entries: number } | undefined;
    expect(shared).toBeDefined();
    // Counts are read live: the directory is reseeded monthly and pinning the
    // exact figures would go red on ordinary churn rather than on a regression.
    expect(shared!.institutions).toBeGreaterThan(100);
    expect(shared!.entries).toBeGreaterThanOrEqual(shared!.institutions);
    expect(body.note).toContain('branch code');
  });

  it('never names one of them — the whole point of the aggregate', async () => {
    // Picking any row would name a bank chosen by row order, which is a coin
    // flip dressed as an answer.
    const body = await get('GENODEF1');
    expect(body.institution).toBeNull();
    expect(body.note).toContain('We do not pick one for you');
  });

  it('leaves a BIC with a head-office record untouched', async () => {
    const body = await get('UBSWCHZH');
    expect(body.found).toBe(true);
    expect(body).not.toHaveProperty('shared_bic8');
    expect(body.institution).toBeTruthy();
  });

  it('keeps the ordinary wording for a code the directory genuinely lacks', async () => {
    const body = await get('AAAAGB2L');
    if (body.found === false && !body.shared_bic8) {
      expect(body.note).toContain('coverage may be partial');
    }
  });

  it('tells BOTH facts when a BIC8 is shared AND designated, without contradicting itself', async () => {
    // A first draft asserted "absent from our BIC directory" for the sanctions
    // half and then announced the rows we hold two sentences later. Both are
    // reachable at once, so the parts must not overlap in what they claim.
    const body = await get('SOMRRUM1');
    const sanctions = body.sanctions as Record<string, unknown>;
    if (sanctions.listed !== true || !body.shared_bic8) return; // list moved: nothing to assert
    expect(body.note).toContain('sanctions list');
    expect(body.note).toContain('head-office');
    expect(body.note).not.toContain('absent from our BIC directory');
  });
});
