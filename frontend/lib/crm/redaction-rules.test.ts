import { describe, expect, it } from 'vitest';
import {
  applyRedactionRules,
  parseRedactionRules,
  recipientDomains,
  redactionInstructions,
} from './redaction-rules';

/**
 * Every fixture here is a reserved example domain and an invented name, on
 * purpose. This file is public, and a test that used the real configured value
 * would put back exactly what the feature exists to keep out.
 */
const RULES = 'example.com=Acme; example.org=Globex';

describe('parseRedactionRules', () => {
  it('reads several rules off one value', () => {
    expect(parseRedactionRules(RULES)).toEqual([
      { domain: 'example.com', name: 'Acme' },
      { domain: 'example.org', name: 'Globex' },
    ]);
  });

  it('accepts newlines as a separator', () => {
    expect(parseRedactionRules('example.com=Acme\nexample.org=Globex')).toHaveLength(2);
  });

  it('is empty when the variable is unset or blank', () => {
    expect(parseRedactionRules(undefined)).toEqual([]);
    expect(parseRedactionRules(null)).toEqual([]);
    expect(parseRedactionRules('')).toEqual([]);
    expect(parseRedactionRules('   ')).toEqual([]);
  });

  it('normalises the domain and keeps the name verbatim', () => {
    expect(parseRedactionRules('  @Example.COM = Acme Holding  ')).toEqual([
      { domain: 'example.com', name: 'Acme Holding' },
    ]);
  });

  it('keeps a name that holds an equals sign', () => {
    expect(parseRedactionRules('example.com=A=B')).toEqual([{ domain: 'example.com', name: 'A=B' }]);
  });

  it('skips malformed entries instead of throwing, so one typo costs one rule', () => {
    expect(parseRedactionRules('nonsense; example.com=Acme; =Ghost; example.net=')).toEqual([
      { domain: 'example.com', name: 'Acme' },
    ]);
  });
});

describe('recipientDomains', () => {
  it('reads a bare address', () => {
    expect(recipientDomains('someone@example.com')).toEqual(['example.com']);
  });

  it('reads a display-name address', () => {
    expect(recipientDomains('A Person <someone@Example.COM>')).toEqual(['example.com']);
  });

  it('reads every address of a list, whatever its position', () => {
    expect(recipientDomains('a@example.com, b@example.org')).toEqual(['example.com', 'example.org']);
  });

  it('drops a trailing separator and repeats no domain', () => {
    expect(recipientDomains('a@example.com., b@example.com')).toEqual(['example.com']);
  });

  it('is empty for anything with no readable domain', () => {
    expect(recipientDomains('not-an-address')).toEqual([]);
    expect(recipientDomains('')).toEqual([]);
    expect(recipientDomains(undefined)).toEqual([]);
    expect(recipientDomains(42)).toEqual([]);
    expect(recipientDomains({ to: 'someone@example.com' })).toEqual([]);
  });
});

describe('redactionInstructions', () => {
  const rules = parseRedactionRules(RULES);

  it('fires on the configured domain', () => {
    expect(redactionInstructions('someone@example.com', rules)).toEqual([
      'IMPORTANT: never mention "Acme" anywhere.',
    ]);
  });

  it('fires on a subdomain of it', () => {
    expect(redactionInstructions('someone@mail.example.com', rules)).toEqual([
      'IMPORTANT: never mention "Acme" anywhere.',
    ]);
  });

  it('ignores a domain that merely ends with the same letters', () => {
    expect(redactionInstructions('someone@notexample.com', rules)).toEqual([]);
  });

  it('is silent for every other recipient', () => {
    expect(redactionInstructions('someone@example.net', rules)).toEqual([]);
  });

  it('fires on a protected recipient sitting anywhere in a list', () => {
    const line = 'IMPORTANT: never mention "Acme" anywhere.';
    expect(redactionInstructions('a@example.com, b@example.net', rules)).toEqual([line]);
    expect(redactionInstructions('a@example.net, b@example.com', rules)).toEqual([line]);
  });

  it('writes one line per rule, not one per address', () => {
    expect(redactionInstructions('a@example.com, b@mail.example.com', rules)).toEqual([
      'IMPORTANT: never mention "Acme" anywhere.',
    ]);
  });

  it('is silent when no rule is configured', () => {
    expect(redactionInstructions('someone@example.com', [])).toEqual([]);
  });

  it('carries one line per matching rule', () => {
    const both = parseRedactionRules('example.com=Acme; mail.example.com=Initech');
    expect(redactionInstructions('someone@mail.example.com', both)).toEqual([
      'IMPORTANT: never mention "Acme" anywhere.',
      'IMPORTANT: never mention "Initech" anywhere.',
    ]);
  });
});

describe('applyRedactionRules', () => {
  const brief = 'Contact: Someone\nGoal: relancer';

  it('appends the instruction as the last line of the brief', () => {
    const out = applyRedactionRules({ to: 'someone@example.com', context: brief }, RULES);
    expect(out).toEqual({
      ok: true,
      body: { to: 'someone@example.com', context: `${brief}\nIMPORTANT: never mention "Acme" anywhere.` },
    });
  });

  it('returns the very same object when no rule matches', () => {
    const body = { to: 'someone@example.net', context: brief };
    const out = applyRedactionRules(body, RULES);
    // Identity, not equality: nothing about a request that needs no rule may
    // differ from what the caller sent.
    expect(out.ok && out.body).toBe(body);
  });

  it('returns the very same object when the variable is unset', () => {
    const body = { to: 'someone@example.com', context: brief };
    const out = applyRedactionRules(body, undefined);
    expect(out.ok && out.body).toBe(body);
  });

  it('leaves the other fields alone', () => {
    const out = applyRedactionRules(
      { account: 'main', to: 'someone@example.com', subject: 'Suivi', context: brief, deposit: false },
      RULES,
    );
    expect(out.ok && out.body).toMatchObject({ account: 'main', subject: 'Suivi', deposit: false });
  });

  it('writes the instruction alone when there is no brief yet', () => {
    for (const context of [undefined, null, '']) {
      const out = applyRedactionRules({ to: 'someone@example.com', context }, RULES);
      expect(out).toEqual({
        ok: true,
        body: { to: 'someone@example.com', context: 'IMPORTANT: never mention "Acme" anywhere.' },
      });
    }
  });

  it('refuses rather than drop the rule when context cannot hold it', () => {
    expect(applyRedactionRules({ to: 'someone@example.com', context: { text: brief } }, RULES)).toEqual({
      ok: false,
      reason: 'unattachable_context',
    });
  });

  it('forwards a body that is not an object, where no rule can apply', () => {
    expect(applyRedactionRules('someone@example.com', RULES)).toEqual({ ok: true, body: 'someone@example.com' });
    expect(applyRedactionRules(null, RULES)).toEqual({ ok: true, body: null });
    expect(applyRedactionRules([{ to: 'someone@example.com' }], RULES)).toEqual({
      ok: true,
      body: [{ to: 'someone@example.com' }],
    });
  });
});
