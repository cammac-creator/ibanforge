import { afterEach, describe, expect, it } from 'vitest';
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

describe('personal mailboxes come from the environment, never from the repository', () => {
  const saved = process.env.CRM_INTERNAL_EMAILS;
  afterEach(() => {
    if (saved === undefined) delete process.env.CRM_INTERNAL_EMAILS;
    else process.env.CRM_INTERNAL_EMAILS = saved;
  });

  it('matches a configured mailbox, and a plus-tag prefix, case-insensitively', () => {
    process.env.CRM_INTERNAL_EMAILS = 'owner@personal.invalid, tagged+';
    expect(isInternalEmail('owner@personal.invalid')).toBe(true);
    expect(isInternalEmail('OWNER@Personal.Invalid')).toBe(true);
    expect(isInternalEmail('tagged+audit@mail.invalid')).toBe(true);
    expect(isInternalEmail('someone-else@personal.invalid')).toBe(false);
  });

  it('degrades visibly when unset: those accounts read as customers', () => {
    // Chosen over failing closed on purpose. An empty list over-counts, which
    // shows up as unexpected customers in the funnel; a closed filter would
    // hide real traffic instead, and that is the failure nobody notices.
    delete process.env.CRM_INTERNAL_EMAILS;
    expect(isInternalEmail('owner@personal.invalid')).toBe(false);
    // The generic patterns keep working with or without the variable.
    expect(isInternalEmail('smoke@acme.example.net')).toBe(true);
  });
});
