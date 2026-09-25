import { afterAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { demo, DEMO_IBANS, OFFICIAL_EXAMPLE_IBANS } from './demo.js';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';

/**
 * GET /v1/demo is the one page of real answers an assistant that cannot send a
 * POST can read (second test of the assistants, 24/09/2026): ChatGPT was
 * convinced by it, DeepSeek did not find it and simulated. So it must keep
 * three promises, each held here:
 *   - its answers are the real validation, not a copy that can drift;
 *   - it shows the verdict a checksum cannot give, on the official examples;
 *   - it dates itself, so that a copy quoted weeks later says when it was true.
 */

/**
 * Les exemples officiels sont tranchés par les registres autrichien et belge,
 * qui quittent le dépôt public (décision du 24/09/2026). Comme le demande le
 * test ci-dessous, les tests reçoivent des registres inventés
 * (src/test-support/restricted-fixtures.ts) plutôt que de retirer les exemples :
 * la production lit toujours les vrais. Installés avant l'évaluation des imports
 * ci-dessus (vi.hoisted passe en premier).
 */
const { fixture } = await vi.hoisted(async () => {
  const m = await import('../test-support/restricted-fixtures.js');
  return { fixture: m.installRestrictedFixture() };
});
afterAll(() => fixture.restore());

function makeApp() {
  const app = new Hono();
  app.route('/', demo);
  return app;
}

interface DemoIban {
  label: string;
  iban: string;
  valid: boolean;
  bank_code_check?: {
    status: string;
    reason?: string;
    authoritative: boolean;
    register: string;
    as_of: string;
  } | null;
  bic?: { code: string; bank_name: string; redirected_from?: string } | null;
}

interface DemoBody {
  served_at: string;
  how_to_read: string;
  iban_examples: DemoIban[];
}

async function getDemo(): Promise<DemoBody> {
  const res = await makeApp().request('/v1/demo');
  expect(res.status).toBe(200);
  return (await res.json()) as DemoBody;
}

describe('GET /v1/demo', () => {
  it('serves every example, in order, the ordinary ones first', async () => {
    const body = await getDemo();
    expect(body.iban_examples.map((e) => e.iban)).toEqual(
      [...DEMO_IBANS, ...OFFICIAL_EXAMPLE_IBANS].map((e) => e.iban),
    );
  });

  it('answers with the real validation, field for field, not a stored copy', async () => {
    const body = await getDemo();
    for (const example of body.iban_examples) {
      const { label, ...answer } = example;
      const expected = validateIBAN(example.iban);
      enrichResult(expected);
      // Through JSON, as the route serves it: undefined fields drop out.
      expect(answer, label).toEqual(JSON.parse(JSON.stringify(expected)));
    }
  });

  it.each(OFFICIAL_EXAMPLE_IBANS.map((e) => [e.iban, e.label]))(
    'shows %s as the national register answers it: allocated to nobody',
    async (iban) => {
      // Sur les registres inventés, un code autrichien ou belge absent des
      // lignes inventées est refusé d'office : ce test tient la forme de la
      // démo, pas les vrais registres. La règle « l'exemple quitte la démo le
      // jour où son registre attribue le code » est vérifiée sur les vrais
      // registres par demo-examples-real-data.test.ts.
      const body = await getDemo();
      const example = body.iban_examples.find((e) => e.iban === iban)!;
      expect(example.valid).toBe(true);
      expect(example.bank_code_check).toMatchObject({
        status: 'not_in_register',
        reason: 'not_allocated',
        authoritative: true,
      });
    },
  );

  it('labels the Swiss example by the bank the answer names, with the redirected code', async () => {
    const body = await getDemo();
    const swiss = body.iban_examples.find((e) => e.iban === 'CH5604835012345678009')!;
    expect(swiss.bic?.bank_name).toBe('UBS Switzerland AG');
    expect(swiss.bic?.redirected_from).toBe('04835');
    expect(swiss.label).toContain('UBS Switzerland AG');
    expect(swiss.label).toContain('04835');
    expect(swiss.label).not.toMatch(/^Switzerland — Credit Suisse$/);
  });

  it('names the provenance of the official examples, never a verdict the answer could contradict', () => {
    for (const { label } of OFFICIAL_EXAMPLE_IBANS) {
      expect(label).toMatch(/official example IBAN/);
      expect(label).not.toMatch(/allocated|nobody|not in/i);
    }
  });

  it('dates itself with served_at, ISO 8601 in UTC, taken on the request', async () => {
    const before = Date.now();
    const body = await getDemo();
    expect(body.served_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Date.parse(body.served_at)).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(Date.parse(body.served_at)).toBeLessThanOrEqual(Date.now());
  });

  it('tells a reader how to read the verdict and not to simulate, without a figure', async () => {
    const body = await getDemo();
    expect(body.how_to_read).toMatch(/not_allocated/);
    expect(body.how_to_read).toMatch(/served_at/);
    expect(body.how_to_read).toMatch(/simulat/);
    // No allowance in it: the verdict and the figures live in the answers.
    expect(body.how_to_read).not.toMatch(/\b\d+\s*(calls?|requests?|validations?|checks?)\b/i);
    expect(body.how_to_read).not.toMatch(/\b(a|per) (day|week|month)\b/i);
  });
});
