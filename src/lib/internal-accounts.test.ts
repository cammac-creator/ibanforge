import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { INTERNAL_EMAIL_RE, isInternalEmail } from './internal-accounts.js';

describe('internal accounts', () => {
  it('keeps ordinary addresses out and probe shapes in', () => {
    expect(isInternalEmail('maria@alpha.example.net')).toBe(false);
    expect(isInternalEmail('someone+tag@gmail.com')).toBe(false);
    expect(isInternalEmail('ci-probe@alpha.example.net')).toBe(true);
  });

  it('stays in sync with the frontend mirror, cohorte.invalid excepted', () => {
    // The two patterns live in one repo, so the contract "keep them in sync"
    // is testable instead of being a comment people forget. The backend adds
    // exactly ONE deliberate alternative: @cohorte.invalid (regrouped abuse
    // cohorts stay VISIBLE in the CRM but out of funnel/stats).
    const here = fileURLToPath(new URL('.', import.meta.url));
    const front = readFileSync(new URL('../../frontend/lib/crm/build-contacts.ts', `file://${here}`), 'utf8');
    const frontSource = /INTERNAL_RE =\s*\/\((.*)\)\/i;/s.exec(front)?.[1];
    expect(frontSource).toBeTruthy();
    const parts = (s: string) => new Set(s.replace(/^\(|\)$/g, '').split('|'));
    const frontParts = parts(frontSource as string);
    const backParts = parts(INTERNAL_EMAIL_RE.source);
    const backOnly = [...backParts].filter((p) => !frontParts.has(p));
    const frontOnly = [...frontParts].filter((p) => !backParts.has(p));
    expect(backOnly).toEqual(['@cohorte\\.invalid']);
    expect(frontOnly).toEqual([]);
  });
});
