import { describe, expect, it } from 'vitest';
import { buildContacts, type ActivationClientRow, type KeyRow } from './build-contacts';
import { buildDossiers, stateOfDossier, type ClientProfileRow, type DossierInput } from './client-dossiers';
import { mailRows, type RowsInput } from './mail-rows';
import { situationOf } from './situation';

/**
 * One word, one population (audit findings TABS-01 and TABS-09, 2026-09-01).
 *
 * Before this file, "endormi" was computed twice from two different bases: the
 * API's activation table on Contacts, where the word is reserved for BUYERS
 * gone quiet for a fortnight, and a window rule on Clients, where it meant
 * anybody at all with no call for a fortnight. The same fortnight, the same
 * screen, two counts. Clicking "Endormis" on one tab and reading the other gave
 * the operator two answers to one question, and neither page was wrong alone.
 *
 * Two unit tests, one per page, could not have caught that: each would have
 * asserted its own rule and both would have passed. So this file feeds ONE
 * fixture through BOTH builders and compares the sets they produce.
 */

const NOW = new Date('2026-08-20T09:00:00Z');

const keyRow = (email: string, over: Partial<KeyRow> = {}): KeyRow => ({
  key_prefix: `ifk_${email.split('@')[0]}`,
  email,
  monthly_limit: 200,
  active: 1,
  created_at: '2026-05-01 10:00:00',
  used: 0,
  used_prev: 0,
  used_all_time: 0,
  last_active_month: '2026-08',
  credits_total: null,
  credits_remaining: null,
  paid: 0,
  series: [],
  ...over,
});

const profile = (prefix: string, over: Partial<ClientProfileRow> = {}): ClientProfileRow => ({
  key_prefix: prefix,
  first_seen: '2026-05-10 09:00:00',
  last_seen: '2026-05-11 09:00:00',
  total: 0,
  ok: 0,
  paywall: 0,
  bad_input: 0,
  auth_or_quota: 0,
  server_error: 0,
  avg_ms: 0,
  p95_ms: 0,
  last_success_at: null,
  last_refusal_at: null,
  endpoints: [],
  countries: [],
  user_agents: [],
  client_kinds: [],
  distinct_ips: 0,
  hours: Array(24).fill(0),
  days: [],
  reject_reasons: [],
  ...over,
});

const activation = (email: string, status: ActivationClientRow['status'], over: Partial<ActivationClientRow> = {}): ActivationClientRow => ({
  email,
  status,
  source: 'direct',
  credits_total: 0,
  credits_remaining: 0,
  packs: 0,
  first_call_at: null,
  calls_90d: 0,
  ...over,
});

/**
 * Four addresses chosen to reproduce the disagreement exactly:
 *
 *  - a buyer the API calls dormant, and whose window is empty too. Both pages
 *    agreed on this one, and still must.
 *  - a FREE signup with no call in the window. The old window rule called this
 *    one "dormant" and the API calls it silent: this row alone was most of the
 *    gap between the two counts.
 *  - a free signup that called yesterday. Active on both.
 *  - an address the activation table does not serve at all, which no filter on
 *    either page can select and which must therefore be counted by neither.
 */
const BUYER = 'buyer@alpha.example.net';
const QUIET_FREE = 'quiet@alpha.example.net';
const CALLER = 'caller@alpha.example.net';
const UNKNOWN = 'unjoined@alpha.example.net';

const keys: KeyRow[] = [
  keyRow(BUYER, { key_prefix: 'ifk_buyer', credits_total: 1000, credits_remaining: 400 }),
  keyRow(QUIET_FREE, { key_prefix: 'ifk_quiet' }),
  keyRow(CALLER, { key_prefix: 'ifk_caller', used: 30, used_all_time: 30 }),
  keyRow(UNKNOWN, { key_prefix: 'ifk_unknown' }),
];

const activationRows: ActivationClientRow[] = [
  activation(BUYER, 'dormant', { credits_total: 1000, credits_remaining: 400, packs: 1 }),
  activation(QUIET_FREE, 'silent'),
  activation(CALLER, 'active', { calls_90d: 30 }),
];

const dossierInput: DossierInput = {
  keys,
  prospects: [],
  messages: [],
  profiles: {
    // A call the day before NOW: inside the fortnight, so the window rule and
    // the API agree this address is active.
    ifk_caller: profile('ifk_caller', { total: 30, ok: 30, last_seen: '2026-08-19 09:00:00', first_seen: '2026-06-01 09:00:00' }),
  },
  monthsByKey: {},
  quotaWarnedByKey: {},
  now: NOW,
  activation: activationRows,
};

function contactsInput(): RowsInput {
  const contacts = buildContacts({
    keys,
    prospects: [],
    messages: [],
    activityByKey: {},
    reads: {},
    months: ['2026-08'],
    activation: activationRows,
  });
  const situations: RowsInput['situations'] = {};
  for (const c of contacts) situations[c.id] = situationOf(c.messages, NOW);
  return { contacts, situations, snoozed: {} };
}

/** The addresses each page puts under one word. */
const dormantOnContacts = () => new Set(mailRows(contactsInput(), 'dormant').map((r) => r.id));
const dormantOnClients = () =>
  new Set(
    buildDossiers(dossierInput)
      .map((d) => ({ id: d.id, st: stateOfDossier(d) }))
      .filter((x) => !x.st.derived && x.st.status === 'dormant')
      .map((x) => x.id),
  );

describe('one vocabulary across Contacts and Clients', () => {
  it('« Endormi » names the same people on both tabs', () => {
    expect([...dormantOnClients()].sort()).toEqual([...dormantOnContacts()].sort());
  });

  it('and that population is the API’s, not a window rule', () => {
    expect(dormantOnClients()).toEqual(new Set([BUYER]));
    // The free signup silent for months was the row the window rule called
    // dormant and the API calls silent. It is no longer counted twice.
    expect(dormantOnClients().has(QUIET_FREE)).toBe(false);
  });

  it('never lets a row carry two words that disagree', () => {
    // The chip and the state word both come from the activation join now, so a
    // row saying "actif" beside a chip saying "endormi" is not expressible.
    for (const d of buildDossiers(dossierInput)) {
      const st = stateOfDossier(d);
      if (d.activation) expect(st.status).toBe(d.activation.status);
      // A precision is never one of the six state words.
      if (st.nuance) expect(['blocked', 'struggling', 'former', 'rising']).toContain(st.nuance);
    }
  });

  it('shows a word for an address activation does not know, and counts it nowhere', () => {
    const d = buildDossiers(dossierInput).find((x) => x.id === UNKNOWN);
    const st = stateOfDossier(d!);
    expect(st.derived).toBe(true);
    // Shown, so no row goes blank...
    expect(st.status).toBe('silent');
    // ...and absent from Contacts, so counting it here would re-open the gap.
    expect(dormantOnContacts().has(UNKNOWN)).toBe(false);
  });
});

describe('stateOfDossier is defensive about the wire', () => {
  it('treats a status word nobody foresaw as derived rather than printing it', () => {
    // The type is a claim about the JSON, not a fact about it: an unknown word
    // used to be able to reach the table as an undefined label.
    const input: DossierInput = {
      ...dossierInput,
      activation: [{ ...activation(QUIET_FREE, 'silent'), status: 'churned' as ActivationClientRow['status'] }],
    };
    const d = buildDossiers(input).find((x) => x.id === QUIET_FREE)!;
    const st = stateOfDossier(d);
    expect(st.derived).toBe(true);
    expect(['new', 'active', 'at-limit', 'paying', 'dormant', 'silent']).toContain(st.status);
  });
});

/**
 * The second word that has to hold the property, and the one that does NOT.
 *
 * Contacts selects « Payants » on `business.packs > 0` (mail-rows.ts) while the
 * Clients tab reads `status === 'paying'`. The activation table sets `paying`
 * on a credited account that called recently, so the two disagree on an account
 * with credits and no recent call, and on any account granted credits outside a
 * pack. Left as a pinned FINDING rather than silently aligned: moving either
 * predicate moves a figure the operator reads daily, and the two questions
 * ("who bought" and "who is a live buyer") are both legitimate.
 */
const payingOnContacts = () => new Set(mailRows(contactsInput(), 'paying').map((r) => r.id));
const payingOnClients = () =>
  new Set(
    buildDossiers(dossierInput)
      .map((d) => ({ id: d.id, st: stateOfDossier(d) }))
      .filter((x) => !x.st.derived && x.st.status === 'paying')
      .map((x) => x.id),
  );

describe('« Payant » — the word the two pages still decide differently', () => {
  it('agrees on a buyer the activation table calls paying', () => {
    const input: DossierInput = {
      ...dossierInput,
      activation: [
        activation(BUYER, 'paying', { credits_total: 1000, credits_remaining: 400, packs: 1 }),
        activation(QUIET_FREE, 'silent'),
        activation(CALLER, 'active', { calls_90d: 30 }),
      ],
    };
    const clients = new Set(
      buildDossiers(input)
        .map((d) => ({ id: d.id, st: stateOfDossier(d) }))
        .filter((x) => !x.st.derived && x.st.status === 'paying')
        .map((x) => x.id),
    );
    expect(clients).toEqual(new Set([BUYER]));
  });

  it('pins the disagreement: a dormant buyer is « payant » on Contacts only', () => {
    // The base fixture calls the buyer `dormant` (bought, gone quiet), and he
    // holds one pack. Contacts counts him under Payants; the Clients tab does
    // not, because the API's word for him is `dormant`.
    expect(payingOnContacts().has(BUYER)).toBe(true);
    expect(payingOnClients().has(BUYER)).toBe(false);
  });
});
