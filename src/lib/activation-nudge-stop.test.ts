import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * A STOP outlives its message.
 *
 * The key dialog promises, since 07/10/2026, "at most one note from the
 * founder, with a link to receive nothing more". Before this guard, a STOP was
 * honoured only by accident: any inbound message silences the founder draft
 * and the activation nudge, but only while that message stays in the CRM.
 * Delete the thread (the CRM has a button for it, and a cleanup of old private
 * messages was on the table the same week) and the address reads as a
 * stranger again: a new key brings a new founder draft, a silent key its
 * nudge. This file proves the refusal survives the deletion, and that a
 * sentence merely containing "stop" is not a refusal.
 *
 * Hermetic database, same reason as activation-nudge-server.test.ts: the pass
 * is capped, and a developer database full of strangers would starve it.
 */
const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-nudge-stop-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

import { rmSync } from 'node:fs';
import { getStatsDB } from './db.js';
import { ensureAliasTable } from './email-aliases.js';
import { generateApiKey } from './api-keys.js';
import { draftId } from './activation-nudge.js';
import { getNudgeLedger, runActivationPass } from './activation-nudge-server.js';

const RUN = Date.now();
const DOMAIN = 'alpha.example.net';
/** Answered the founder note with STOP, then the thread was deleted. */
const STOPPER = `stopper-${RUN}@${DOMAIN}`;
/** Wrote a sentence with "stop" in it: a person talking, not a refusal. */
const TALKER = `talker-${RUN}@${DOMAIN}`;
/** One declared person behind two addresses: the STOP came from the alias. */
const CANON = `canon-${RUN}@${DOMAIN}`;
const ALIAS = `alias-${RUN}@${DOMAIN}`;

const saved = { url: process.env.MAIL_RELAY_URL, secret: process.env.MAIL_RELAY_SECRET };

function mint(email: string, ageHours: number): string {
  const result = generateApiKey(email);
  if (!result) throw new Error(`could not mint ${email}`);
  getStatsDB()
    .prepare(`UPDATE api_keys SET created_at = datetime('now', ?) WHERE key_prefix = ?`)
    .run(`-${ageHours} hours`, result.key_prefix);
  return result.key_prefix;
}

function inbound(id: string, email: string, subject: string, body: string, from = email): void {
  getStatsDB()
    .prepare(
      `INSERT INTO email_messages (id, customer_email, direction, msg_date, subject, snippet, body, counterparty)
       VALUES (?, ?, 'in', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      email,
      new Date().toISOString().slice(0, 16),
      subject,
      body.slice(0, 280),
      body,
      `"A person" <${from}>`,
    );
}

function messagesOf(email: string): Array<{ id: string; direction: string }> {
  return getStatsDB()
    .prepare('SELECT id, direction FROM email_messages WHERE customer_email = ?')
    .all(email) as Array<{ id: string; direction: string }>;
}

beforeAll(() => {
  // A relay that is "configured" and refuses at once (port 9, discard): the
  // nudge half really runs and really claims, and not a byte leaves.
  process.env.MAIL_RELAY_URL = 'http://127.0.0.1:9/relay-that-refuses';
  process.env.MAIL_RELAY_SECRET = 'not-a-real-secret';

  // Old enough and never called: each one is a nudge candidate.
  mint(STOPPER, 72);
  mint(TALKER, 72);
  ensureAliasTable();
  mint(CANON, 72);
  getStatsDB()
    .prepare('INSERT INTO email_aliases (alias, canonical) VALUES (?, ?)')
    .run(ALIAS, CANON);

  inbound(
    `stop-${RUN}`,
    STOPPER,
    'Re: Two questions about your IBANforge key',
    'STOP\n\nOn Tue, Claude-Alain Martin wrote:\n> Hello,',
  );
  inbound(
    `talk-${RUN}`,
    TALKER,
    'Re: Two questions about your IBANforge key',
    'Thanks! Stop me if this is the wrong person, but we validate supplier IBANs.',
  );
  // The mailto link of the note: subject STOP, sent from the alias address.
  inbound(`alias-stop-${RUN}`, CANON, 'STOP', '', ALIAS);
});

afterAll(() => {
  if (saved.url === undefined) delete process.env.MAIL_RELAY_URL;
  else process.env.MAIL_RELAY_URL = saved.url;
  if (saved.secret === undefined) delete process.env.MAIL_RELAY_SECRET;
  else process.env.MAIL_RELAY_SECRET = saved.secret;
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${HERMETIC_DB}${suffix}`, { force: true });
});

describe('a STOP', () => {
  it('is recorded by the pass, for the sender and for the person an alias declares', async () => {
    const report = await runActivationPass();
    expect(report.stopped).toContain(STOPPER);
    expect(report.stopped).toContain(CANON);
    expect(report.stopped).not.toContain(ALIAS); // recorded under the person, not the spelling
    expect(report.stopped).not.toContain(TALKER);
    expect(report.errors).toEqual([]);
  });

  it('survives the deletion of the thread: no founder draft, no nudge, ever', async () => {
    const db = getStatsDB();
    for (const email of [STOPPER, TALKER, CANON]) {
      db.prepare('DELETE FROM email_messages WHERE customer_email = ?').run(email);
    }
    // A new key inside the draft window: without the guard, the "already has a
    // thread" check sees an empty thread and writes the founder draft again.
    mint(STOPPER, 47);
    mint(CANON, 47);

    const report = await runActivationPass();

    expect(messagesOf(STOPPER), 'no founder draft for an address under STOP').toEqual([]);
    expect(messagesOf(CANON), 'nor for the person behind the alias').toEqual([]);
    expect(
      db.prepare('SELECT 1 FROM email_messages WHERE id = ?').get(draftId(STOPPER)),
    ).toBeUndefined();

    const ledger = new Set(getNudgeLedger(1000).map((r) => r.email));
    expect(ledger.has(STOPPER), 'no nudge for an address under STOP').toBe(false);
    expect(ledger.has(CANON)).toBe(false);
    expect(report.nudged.map((n) => n.email)).not.toContain(STOPPER);
    expect(report.stopped).toEqual(expect.arrayContaining([STOPPER, CANON]));
  });

  it('is only a STOP: the person who merely wrote "stop" in a sentence is written to again', async () => {
    // Their thread is gone too (previous test), so nothing but the STOP guard
    // could keep them out: the pass claims their one nudge, which proves the
    // guard is about the refusal and not about the word.
    await runActivationPass();
    const ledger = getNudgeLedger(1000).filter((r) => r.email === TALKER);
    expect(ledger).toHaveLength(1);
  });
});
