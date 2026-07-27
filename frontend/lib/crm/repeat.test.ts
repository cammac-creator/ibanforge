import { describe, expect, it } from 'vitest';
import {
  lastOutbound,
  MIN_SHINGLES,
  overlap,
  repeatRatio,
  sameSubject,
  SHINGLE,
} from './repeat';
import type { Message } from './types';

/**
 * The mail already sent, as this CRM sends them: a greeting, three short
 * paragraphs, a closing formula and a signature. Invented, on a reserved
 * example domain, like every fixture in this repository.
 *
 * Long enough to be judged: 88 words, so both the whole text and its first 280
 * characters clear MIN_SHINGLES. Several tests below depend on that, and on the
 * closing formula being a formula, that is, the kind of sentence a second mail
 * legitimately repeats word for word.
 */
const SENT = `Bonjour,

Je construis une petite interface qui vérifie un identifiant bancaire, retrouve l'établissement correspondant et renvoie le tout en une seule requête, sans aucune base à maintenir de votre côté.

Votre équipe publie des intégrations de facturation, et la saisie des coordonnées bancaires y revient sans cesse. Je peux vous montrer le résultat sur vos propres données en quelques minutes, quand cela vous arrange.

Si le sujet ne vous parle pas, dites-le moi franchement et je ne reviendrai pas dessus.

Bien à vous,
Claude-Alain`;

/** What the store keeps when it keeps only a snippet: the API caps it at 280. */
const SENT_SNIPPET = SENT.slice(0, 280);

/**
 * A genuine follow-up, and the hardest legitimate case there is: it repeats the
 * greeting, the whole closing formula and the signature, and says something the
 * first mail never said. Nothing here may raise a warning.
 */
const GENUINE = `Bonjour,

Combien de temps votre support passe-t-il chaque semaine à corriger un numéro de compte mal saisi ? Si la réponse dépasse dix minutes, je crois avoir de quoi vous aider très vite.

Si le sujet ne vous parle pas, dites-le moi franchement et je ne reviendrai pas dessus.

Bien à vous,
Claude-Alain`;

/**
 * The same mail with one word in six swapped for a synonym: the lazy rewrite a
 * generator produces when it is told not to repeat itself and repeats itself.
 */
const REWORDED = `Bonjour,

Je développe une petite interface qui contrôle un identifiant bancaire, retrouve l'établissement associé et renvoie le tout en une seule requête, sans aucune base à tenir de votre côté.

Votre équipe publie des intégrations de facturation, et la saisie des coordonnées bancaires y revient sans arrêt. Je peux vous montrer le résultat sur vos propres données en quelques minutes, quand cela vous convient.

Si le sujet ne vous parle pas, dites-le moi franchement et je ne reviendrai pas là dessus.

Bien à vous,
Claude-Alain`;

/** n words, all distinct, so a shingle count can be hit on the nose. */
const words = (n: number, prefix = 'w') =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');

const out = (over: Partial<Message> = {}): Message => ({
  direction: 'out',
  msg_date: '2026-07-01',
  subject: 'Suivi',
  snippet: 'Un extrait.',
  body: 'Un corps.',
  counterparty: 'someone@example.net',
  ...over,
});

describe('overlap', () => {
  it('is 1 on two identical texts', () => {
    expect(overlap(SENT, SENT)).toBe(1);
  });

  it('is 0 on two texts sharing no run of three words', () => {
    expect(overlap(words(40, 'a'), words(40, 'b'))).toBe(0);
  });

  it('is 1 when the shorter text sits whole inside the longer one', () => {
    // The paste that dilution would hide: a paragraph of the mail already sent,
    // dropped into a mail three times its length. Measured against the new
    // text alone this is a third; measured against the shorter of the two, and
    // therefore against what was pasted, it is everything.
    const pasted = `${words(20, 'x')} ${SENT} ${words(20, 'y')}`;
    expect(overlap(SENT, pasted)).toBe(1);
  });

  it('gives the same answer whichever way round the two texts are handed in', () => {
    // The property that makes the truncated-previous case work at all. A ratio
    // taken over the new text alone answers "how much of what I am about to
    // send is old", which is 0 the moment the old mail is the shorter one.
    const pasted = `${words(20, 'x')} ${SENT}`;
    expect(overlap(pasted, SENT)).toBe(overlap(SENT, pasted));
  });

  it('counts runs of exactly three words', () => {
    // Pinned on the nose rather than described. `a b c d e` holds the trigrams
    // abc, bcd, cde and `a b c x y` holds abc, bcx, cxy: one shared out of
    // three each way. Any other shingle length gives another number, so this is
    // where a change to SHINGLE has to be admitted.
    expect(SHINGLE).toBe(3);
    expect(overlap('a b c d e', 'a b c x y')).toBeCloseTo(1 / 3, 10);
  });

  it('is 0 when a text is shorter than one shingle', () => {
    expect(overlap('deux mots', SENT)).toBe(0);
  });

  it('ignores case, punctuation and the shape of the apostrophe', () => {
    // Both apostrophes occur: the interface writes U+2019, an operator types
    // U+0027, and the same sentence must not read as two different ones.
    const a = "L'établissement correspondant, retrouvé en une seule requête.";
    const b = 'l’établissement CORRESPONDANT retrouvé en une seule requête';
    expect(overlap(a, b)).toBe(1);
  });
});

describe('repeatRatio', () => {
  it('says nothing at all about texts too short to judge', () => {
    // Under the floor the ratio is decided by the greeting and the signature,
    // which two different mails share legitimately. Abstaining is not the same
    // answer as "no repetition", so it is a different value.
    const short = words(MIN_SHINGLES + SHINGLE - 2);
    expect(repeatRatio(short, SENT)).toBeNull();
    expect(repeatRatio(SENT, short)).toBeNull();
  });

  it('judges as soon as both sides reach the floor', () => {
    const justEnough = words(MIN_SHINGLES + SHINGLE - 1);
    expect(repeatRatio(justEnough, SENT)).not.toBeNull();
  });

  it('is 1 on the mail already sent, handed back word for word', () => {
    expect(repeatRatio(SENT, SENT)).toBe(1);
  });

  it('still catches the whole mail when only its opening was stored', () => {
    // The store does not fill `body` on every row, so the previous mail can be
    // 280 characters of a mail that was 600. Measured against the new text
    // alone that copy scores under a half and passes unseen, which is the very
    // defect this rule exists for.
    const r = repeatRatio(SENT, SENT_SNIPPET);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.9);
  });

  it('stays quiet on a follow-up that only shares the greeting, the closing and the signature', () => {
    const r = repeatRatio(GENUINE, SENT);
    expect(r).not.toBeNull();
    expect(r!).toBeLessThan(0.5);
  });

  it('catches a rewrite that swaps one word in six', () => {
    const r = repeatRatio(REWORDED, SENT);
    expect(r!).toBeGreaterThan(0.5);
  });
});

describe('sameSubject', () => {
  it('matches the same line written the same way', () => {
    expect(sameSubject('Suivi de notre échange', 'Suivi de notre échange')).toBe(true);
  });

  it('matches through case, spacing and punctuation', () => {
    expect(sameSubject('  suivi de   notre échange ', 'Suivi de notre échange !')).toBe(true);
  });

  it('does not match a subject that says something else', () => {
    expect(sameSubject('Une dernière idée', 'Suivi de notre échange')).toBe(false);
  });

  it('does not match a subject that merely starts the same way', () => {
    // Word by word and to the end, not a prefix test: "Suivi" is not the same
    // line as "Suivi de notre échange", and comparing only as far as the
    // shorter one goes would make every short subject match a longer one.
    expect(sameSubject('Suivi', 'Suivi de notre échange')).toBe(false);
    expect(sameSubject('Suivi de notre échange', 'Suivi')).toBe(false);
  });

  it('does not match a reply prefix against the bare line', () => {
    // Deliberate: "Re: X" answering "X" is ordinary mail, not a duplicate.
    expect(sameSubject('Re: Suivi', 'Suivi')).toBe(false);
  });

  it('says nothing when there is no previous subject, or nothing in either', () => {
    expect(sameSubject('Suivi', null)).toBe(false);
    expect(sameSubject('   ', '   ')).toBe(false);
    expect(sameSubject('', '')).toBe(false);
  });
});

describe('lastOutbound', () => {
  it('finds the last mail we sent, not the first', () => {
    const r = lastOutbound([
      out({ subject: 'Premier', body: 'Le premier.' }),
      out({ subject: 'Second', body: 'Le second.' }),
    ]);
    expect(r).toEqual({ subject: 'Second', text: 'Le second.' });
  });

  it('never returns one of theirs', () => {
    const r = lastOutbound([
      out({ subject: 'À moi', body: 'Le mien.' }),
      out({ direction: 'in', subject: 'À eux', body: 'Le leur.' }),
    ]);
    expect(r).toEqual({ subject: 'À moi', text: 'Le mien.' });
  });

  it('never returns a draft, even when the draft is the last row', () => {
    // A draft has not been sent, so nothing in it has been said yet. Comparing
    // a draft against itself would warn about a repetition of nothing.
    const r = lastOutbound([
      out({ subject: 'Envoyé', body: 'Parti.' }),
      out({ direction: 'draft', subject: 'Brouillon', body: 'Pas parti.' }),
    ]);
    expect(r).toEqual({ subject: 'Envoyé', text: 'Parti.' });
  });

  it('falls back to the snippet when the body was not stored', () => {
    const r = lastOutbound([out({ body: null, snippet: 'Que le début.' })]);
    expect(r).toEqual({ subject: 'Suivi', text: 'Que le début.' });
  });

  it('prefers the body to the snippet, which is only its opening', () => {
    const r = lastOutbound([out({ body: 'Le corps entier.', snippet: 'Le corps' })]);
    expect(r!.text).toBe('Le corps entier.');
  });

  it('skips an outbound row that carries no text at all', () => {
    const r = lastOutbound([
      out({ subject: 'Avec du texte', body: 'Du texte.' }),
      out({ subject: 'Vide', body: '   ', snippet: null }),
    ]);
    expect(r).toEqual({ subject: 'Avec du texte', text: 'Du texte.' });
  });

  it('returns nothing when nothing was ever sent', () => {
    expect(lastOutbound([])).toBeNull();
    expect(lastOutbound([out({ direction: 'in' })])).toBeNull();
  });
});
