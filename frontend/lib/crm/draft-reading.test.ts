import { describe, it, expect } from 'vitest';
import { draftReading } from './draft-reading';
import type { Message } from './types';

function draft(over: Partial<Message> = {}): Message {
  return {
    id: 'd1',
    customer_email: 'pilot@example.com',
    direction: 'draft',
    msg_date: '2026-07-29T09:00',
    subject: 'Re: The payee half of your KYA check',
    snippet: null,
    body: 'Hi Alex, your three-layer split is right.',
    snippet_fr: 'Bonjour Alex, votre découpage en trois couches est juste.',
    lang: 'en',
    ...over,
  } as Message;
}

describe('draftReading', () => {
  it('shows the translation by default when one exists', () => {
    const r = draftReading(draft(), false);
    expect(r.text).toMatch(/^Bonjour Alex/);
    expect(r.isTranslation).toBe(true);
    expect(r.canTranslate).toBe(true);
  });

  it('shows the body that would actually be sent when the operator asks for the original', () => {
    const r = draftReading(draft(), true);
    expect(r.text).toMatch(/^Hi Alex/);
    expect(r.isTranslation).toBe(false);
  });

  it('never reports a translation for a draft already written in French', () => {
    const r = draftReading(draft({ lang: 'fr', snippet_fr: 'doublon' }), false);
    expect(r.canTranslate).toBe(false);
    expect(r.isTranslation).toBe(false);
    expect(r.text).toMatch(/^Hi Alex/);
  });

  it('ignores a malformed language code rather than offering an empty toggle', () => {
    for (const lang of ['und', '<iso-639-1>', '', 'english']) {
      const r = draftReading(draft({ lang }), false);
      expect(r.canTranslate, `lang=${lang}`).toBe(false);
      expect(r.isTranslation).toBe(false);
    }
  });

  it('ignores a blank translation', () => {
    for (const fr of ['', '   ', null]) {
      const r = draftReading(draft({ snippet_fr: fr }), false);
      expect(r.canTranslate).toBe(false);
      expect(r.text).toMatch(/^Hi Alex/);
    }
  });

  it('falls back to the snippet when the body is missing', () => {
    const r = draftReading(draft({ body: null, snippet: 'court', snippet_fr: null }), false);
    expect(r.text).toBe('court');
    expect(r.isTranslation).toBe(false);
  });

  it('flags the translation so the card can say it is not what gets sent', () => {
    // The one invariant that matters: whenever text !== the sendable body,
    // isTranslation must be true.
    const d = draft();
    const r = draftReading(d, false);
    expect(r.text).not.toBe(d.body);
    expect(r.isTranslation).toBe(true);
  });
});
