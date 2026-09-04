import { describe, it, expect } from 'vitest';
import { freshOnly, splitQuoted } from './quoted';

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
    // which `toContain` cannot do. It catches a cut starting one line too late, which
    // drops the separator. A cut one line too early is hidden by the trim().
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

describe('freshOnly', () => {
  it('agrees with splitQuoted whenever there is any new text', () => {
    for (const body of [
      'Bonjour,\n\nMerci pour le retour.',
      'Yes, that works.\n\n> we agreed already',
      'Short answer: yes.\n\nOn Tue, 21 Jul 2026, someone wrote:\nthe old mail',
    ]) {
      expect(freshOnly(body)).toBe(splitQuoted(body).fresh);
    }
  });

  it('is empty on a reply that opens on a quote marker, where splitQuoted is not', () => {
    // The divergence this function exists for: splitQuoted returns the quoted
    // history so the thread bubble is never empty, and that history is usually
    // the mail we sent. A generator handed it would send it back.
    const body = '> the whole mail we sent\n> second line';
    expect(splitQuoted(body).fresh).toContain('the whole mail we sent');
    expect(freshOnly(body)).toBe('');
  });

  it('is empty on a reply that opens on an attribution line', () => {
    const body = 'Le 21 juillet 2026, Claude-Alain a écrit :\nle mail que nous avons envoyé';
    expect(freshOnly(body)).toBe('');
  });

  it('handles null and empty bodies', () => {
    expect(freshOnly(null)).toBe('');
    expect(freshOnly('   ')).toBe('');
  });
});

describe('header blocks without a separator (Outlook, Apple Mail, and the translator)', () => {
  it('cuts at a French header block, the form the translator emits', () => {
    const body = [
      'Merci pour votre message, voici mes réponses.',
      '',
      'De : Claude-Alain Martin <ops@alpha.example.net>',
      'Envoyé : mercredi 2 septembre 2026 16:09',
      'À : info@beta.example.org',
      'Objet : Deux questions',
      '',
      'Bonjour,',
    ].join('\n');
    const r = splitQuoted(body);
    expect(r.fresh).toBe('Merci pour votre message, voici mes réponses.');
    expect(r.quoted.startsWith('De : Claude-Alain Martin')).toBe(true);
    expect(freshOnly(body)).toBe('Merci pour votre message, voici mes réponses.');
  });

  it('cuts at a German Outlook header block', () => {
    const body =
      'Danke, passt.\n\nVon: Ops <ops@alpha.example.net>\nGesendet: Mittwoch, 2. September 2026 16:09\nAn: info@beta.example.org\nBetreff: Zwei Fragen\n\nHallo,';
    expect(splitQuoted(body).fresh).toBe('Danke, passt.');
  });

  it('does not cut on a lone "De :" line inside prose', () => {
    const body = 'De : rien à signaler de notre côté.\nNous reprenons contact lundi.';
    expect(splitQuoted(body)).toEqual({ fresh: body, quoted: '' });
  });

  it('cuts at a Dutch attribution line', () => {
    const body =
      'Prima, dank.\nOp 2 sep. 2026 om 16:09 schreef Ops <ops@alpha.example.net>:\n> hallo';
    expect(splitQuoted(body).fresh).toBe('Prima, dank.');
  });
});
