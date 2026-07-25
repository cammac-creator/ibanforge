import { describe, it, expect } from 'vitest';
import { splitQuoted } from './quoted';

describe('splitQuoted', () => {
  it('returns everything as fresh when there is no quote marker', () => {
    const r = splitQuoted('Bonjour,\n\nMerci pour le retour.\n\nClaude-Alain');
    expect(r.fresh).toBe('Bonjour,\n\nMerci pour le retour.\n\nClaude-Alain');
    expect(r.quoted).toBe('');
  });

  it('cuts at the first line starting with >', () => {
    const r = splitQuoted('Yes, that works.\n\n> On the previous point\n> we agreed already');
    expect(r.fresh).toBe('Yes, that works.');
    expect(r.quoted).toContain('> On the previous point');
  });

  it('cuts at an Outlook style From: block', () => {
    const body =
      'Thanks, noted.\n\n________________________________\nFrom: Someone <a@example.com>\nSent: Monday\nSubject: Re: test';
    const r = splitQuoted(body);
    expect(r.fresh).toBe('Thanks, noted.');
    // The one exact assertion on `quoted` in the suite: it pins the cut boundary,
    // which `toContain` cannot do. An off-by-one cut would land on the blank line.
    expect(r.quoted).toBe(
      '________________________________\nFrom: Someone <a@example.com>\nSent: Monday\nSubject: Re: test',
    );
  });

  it('cuts at a labeled Original Message delimiter', () => {
    const body =
      'Thanks, noted.\n\n-----Original Message-----\nFrom: Someone <a@example.com>\nSent: Monday\nSubject: Re: test';
    const r = splitQuoted(body);
    expect(r.fresh).toBe('Thanks, noted.');
    expect(r.quoted).toContain('-----Original Message-----');
  });

  it('cuts at a French "a écrit :" attribution', () => {
    const r = splitQuoted('D accord.\n\nLe 10 juillet 2026, Jean a écrit :\nle texte cité');
    expect(r.fresh).toBe('D accord.');
    expect(r.quoted).toContain('a écrit :');
  });

  it('cuts at an English "wrote:" attribution', () => {
    const r = splitQuoted('Sounds good.\n\nOn 10 Jul 2026, Jean wrote:\nquoted text');
    expect(r.fresh).toBe('Sounds good.');
    expect(r.quoted).toContain('wrote:');
  });

  it('cuts at a German attribution line', () => {
    const r = splitQuoted(
      'Danke,\n\nAm 10. Juli 2026 um 09:12 schrieb Jean <j@example.com>:\nzitierter Text',
    );
    expect(r.fresh).toBe('Danke,');
    expect(r.quoted).toContain('schrieb');
  });

  it('does not cut on a decorative separator with no header after it', () => {
    const r = splitQuoted('Point one.\n\n--------\n\nPoint two.');
    expect(r.fresh).toBe('Point one.\n\n--------\n\nPoint two.');
    expect(r.quoted).toBe('');
  });

  it('does not cut on prose that merely ends with "wrote:"', () => {
    const body = 'Hi,\n\nOn the API design you wrote:\nplease keep v1 stable.';
    const r = splitQuoted(body);
    expect(r.fresh).toBe(body);
    expect(r.quoted).toBe('');
  });

  it('does not cut on prose that merely ends with "a écrit :"', () => {
    // The attribution must not sit on line 0: a cut there is masked by the
    // purely-quoted fallback, which would make this test pass either way.
    const body = 'Bonjour,\n\nLe rapport que Jean a écrit :\nvoir la page 4.';
    const r = splitQuoted(body);
    expect(r.fresh).toBe(body);
    expect(r.quoted).toBe('');
  });

  it('keeps the quote as fresh when the reply is purely quoted', () => {
    const r = splitQuoted('> only quoted content here');
    expect(r.fresh).toBe('> only quoted content here');
    expect(r.quoted).toBe('');
  });

  it('handles null and empty bodies', () => {
    expect(splitQuoted(null)).toEqual({ fresh: '', quoted: '' });
    expect(splitQuoted('   ')).toEqual({ fresh: '', quoted: '' });
  });
});
