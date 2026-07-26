import { describe, it, expect } from 'vitest';
import {
  changedRows,
  confirmedSent,
  generatedDraft,
  readAnswer,
  reasonOf,
  withReason,
  type ApiAnswer,
} from './api-result';

const answer = (ok: boolean, body: unknown): ApiAnswer => ({ ok, body });

describe('readAnswer', () => {
  it('keeps the parsed body next to the HTTP verdict', async () => {
    const a = await readAnswer({ ok: true, json: async () => ({ upserted: 1 }) });
    expect(a).toEqual({ ok: true, body: { upserted: 1 } });
  });

  it('survives a body that is not JSON at all', async () => {
    const a = await readAnswer({
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    expect(a).toEqual({ ok: false, body: null });
  });
});

describe('reasonOf', () => {
  it('reads FastAPI detail first, which is how the VPS says the mailbox is not configured', () => {
    // The shape of HTTPException(404), forwarded verbatim by the Next proxy.
    expect(reasonOf(answer(false, { detail: 'no active account box@example.net' }))).toBe(
      'no active account box@example.net',
    );
  });

  it('prefers the sentence in message over the slug in error', () => {
    expect(reasonOf(answer(false, { error: 'not_configured', message: 'Secret manquant' }))).toBe(
      'Secret manquant',
    );
  });

  it('falls back to the slug when that is all there is', () => {
    expect(reasonOf(answer(false, { error: 'upstream_failed' }))).toBe('upstream_failed');
  });

  it('returns null rather than an empty string when nothing is usable', () => {
    expect(reasonOf(answer(false, { message: '   ' }))).toBeNull();
    expect(reasonOf(answer(false, {}))).toBeNull();
    expect(reasonOf(answer(false, null))).toBeNull();
    expect(reasonOf(answer(false, 'plain text'))).toBeNull();
    expect(reasonOf(answer(false, { detail: 42 }))).toBeNull();
  });
});

describe('changedRows', () => {
  it('accepts a count of one or more', () => {
    expect(changedRows(answer(true, { upserted: 1 }), 'upserted')).toBe(true);
    expect(changedRows(answer(true, { deleted: 3 }), 'deleted')).toBe(true);
  });

  it('refuses a 200 that changed nothing, which is the whole point', () => {
    expect(changedRows(answer(true, { upserted: 0 }), 'upserted')).toBe(false);
    expect(changedRows(answer(true, { deleted: 0 }), 'deleted')).toBe(false);
  });

  it('refuses the saved:true the draft route adds on top of upserted:0', () => {
    // /api/crm/draft-message answers { saved: true, id, ...upstream }, so the
    // flag is present even when the row was skipped. Only the count is proof.
    expect(changedRows(answer(true, { saved: true, id: 'draft-x', upserted: 0 }), 'upserted')).toBe(
      false,
    );
  });

  it('refuses a missing or non-numeric counter', () => {
    expect(changedRows(answer(true, { error: 'bad_upstream_response' }), 'upserted')).toBe(false);
    expect(changedRows(answer(true, { upserted: '2' }), 'upserted')).toBe(false);
    expect(changedRows(answer(true, null), 'deleted')).toBe(false);
  });

  it('refuses anything on a non-2xx, whatever the body claims', () => {
    expect(changedRows(answer(false, { upserted: 5 }), 'upserted')).toBe(false);
  });

  it('reads the counter it was asked for and no other', () => {
    expect(changedRows(answer(true, { deleted: 1 }), 'upserted')).toBe(false);
  });
});

describe('confirmedSent', () => {
  it('accepts the sent flag the VPS returns', () => {
    expect(confirmedSent(answer(true, { sent: true, to: 'x@example.net' }))).toBe(true);
  });

  it('refuses a 200 without the flag, since recordSent did not run either', () => {
    expect(confirmedSent(answer(true, { to: 'x@example.net' }))).toBe(false);
    expect(confirmedSent(answer(true, { sent: false }))).toBe(false);
    expect(confirmedSent(answer(true, { sent: 'true' }))).toBe(false);
  });

  it('refuses a failure that carries the flag', () => {
    expect(confirmedSent(answer(false, { sent: true }))).toBe(false);
  });
});

describe('withReason', () => {
  it('names the action and quotes the endpoint', () => {
    expect(withReason('Échec de la génération', 'no active account box@example.net')).toBe(
      'Échec de la génération : no active account box@example.net.',
    );
  });

  it('closes the sentence when there is no reason', () => {
    expect(withReason('Échec de l’envoi', null)).toBe('Échec de l’envoi.');
  });

  it('does not double the final period, so a caller can append a sentence', () => {
    expect(withReason('Échec', 'send failed: timed out.')).toBe('Échec : send failed: timed out.');
    expect(withReason('Échec', 'boom...  ')).toBe('Échec : boom.');
  });
});

describe('generatedDraft', () => {
  it('takes the three fields the VPS returns', () => {
    expect(
      generatedDraft(
        answer(true, { subject: 'Quick question', email_en: 'Hello,', translation_fr: 'Bonjour,' }),
      ),
    ).toEqual({ subject: 'Quick question', emailEn: 'Hello,', translationFr: 'Bonjour,' });
  });

  it('accepts a generation with no translation', () => {
    expect(generatedDraft(answer(true, { subject: 'S', email_en: 'Body', translation_fr: '' })))
      .toEqual({ subject: 'S', emailEn: 'Body', translationFr: null });
  });

  it('defaults a missing subject to empty rather than to undefined', () => {
    // An undefined here would turn the controlled subject input uncontrolled.
    expect(generatedDraft(answer(true, { email_en: 'Body' }))).toEqual({
      subject: '',
      emailEn: 'Body',
      translationFr: null,
    });
  });

  it('refuses an answer with no usable body to review', () => {
    expect(generatedDraft(answer(true, { subject: 'S', email_en: '  ' }))).toBeNull();
    expect(generatedDraft(answer(true, { error: 'bad_upstream_response' }))).toBeNull();
    expect(generatedDraft(answer(true, null))).toBeNull();
    expect(generatedDraft(answer(false, { email_en: 'Body' }))).toBeNull();
  });
});
