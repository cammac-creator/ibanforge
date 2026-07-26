import { describe, expect, it } from 'vitest';
import { checkDraft } from './guardrails';
import { HARD_CAP, SOFT_CAP } from './sent-today';

/**
 * A followup that breaks no rule: 60 words, no link, no spam word, no em dash.
 * The word count is deliberate and was measured, not guessed. It sits inside
 * the followup window (40-90) and *below* the first-touch minimum (90), so the
 * same string is a clean followup and a too-short cold mail. Several tests
 * below use that to prove the window actually depends on isFirstTouch.
 *
 * It also contains "dites-le moi": a hyphen must never be read as an em dash.
 */
const cleanFollowup =
  "Bonjour, je reviens vers vous après notre échange du mois dernier au sujet de la vérification des coordonnées bancaires dans votre outil de facturation. Vous m'aviez dit que le sujet reviendrait sur la table à la rentrée. Est-ce toujours d'actualité de votre côté ? Si le moment n'est pas le bon, dites-le moi franchement et je repasserai en fin d'année.";

/**
 * A cold first mail that breaks no rule: 99 words, one link, an opt-out hint
 * ("STOP"), no spam word, no em dash. 99 sits inside the first-touch window
 * (90-140) and *above* the followup maximum (90), the mirror image of the
 * fixture above.
 */
const cleanColdMail =
  "Bonjour, je me permets de vous écrire parce que votre équipe publie des intégrations bancaires et que la vérification des coordonnées y revient sans cesse. De notre côté, nous exposons une interface qui contrôle un identifiant bancaire, retrouve l'établissement correspondant et renvoie le tout en une seule requête, sans base à maintenir chez vous. Si le sujet vous parle, je peux vous montrer le résultat sur vos propres données en quelques minutes. Le détail est ici : https://ibanforge.com. Si ce message tombe à côté, répondez STOP et je ne vous écrirai plus. Merci de votre lecture et belle journée.";

const codes = (r: ReturnType<typeof checkDraft>) => r.issues.map((i) => i.code);

/**
 * U+2014, spelled as an escape so that no fixture shares a pasted character
 * with the rule it exercises. A rule that blocked on the en dash U+2013 by
 * accident would otherwise still pass every test below.
 */
const EM_DASH = '\u2014';

/** Exactly n words, so a length boundary can be hit on the nose. */
const wordsBody = (n: number) => Array.from({ length: n }, () => 'mot').join(' ');

describe('checkDraft', () => {
  it('accepts a clean followup', () => {
    const r = checkDraft({ body: cleanFollowup, sentToday: 2, isFirstTouch: false });
    // toEqual([]) rather than a list of not.toContain: an implementation that
    // returns nothing at all has to fail somewhere, and this is where.
    expect(r.issues).toEqual([]);
    expect(r.blocking).toBe(false);
  });

  it('blocks on an em dash', () => {
    // Spelled as an escape on purpose. Written as a literal, this fixture and
    // the rule it exercises would be the same pasted character, so a rule that
    // blocked on the en dash U+2013 by accident would still pass here. U+2014
    // is the character the owner's rule is about, and nothing else is.
    const r = checkDraft({ body: `Bonjour ${EM_DASH} voici la suite.`, sentToday: 0, isFirstTouch: false });
    expect(r.blocking).toBe(true);
    expect(codes(r)).toContain('em_dash');
  });

  it('does not mistake a hyphen for an em dash', () => {
    // The rule is about U+2014, the character that reads as a machine wrote the
    // sentence. A hyphen is ordinary French and appears in most mails.
    const r = checkDraft({ body: 'Dites-moi si ce rendez-vous vous convient.', sentToday: 0, isFirstTouch: false });
    expect(codes(r)).not.toContain('em_dash');
    expect(r.blocking).toBe(false);
  });

  it('blocks at the hard daily cap', () => {
    const r = checkDraft({
      body: 'Une relance courte et polie qui pose une question.',
      sentToday: HARD_CAP,
      isFirstTouch: false,
    });
    expect(r.blocking).toBe(true);
    expect(codes(r)).toContain('daily_cap');
  });

  it('warns but does not block from the soft cap', () => {
    const r = checkDraft({
      body: 'Une relance courte et polie qui pose une question.',
      sentToday: SOFT_CAP,
      isFirstTouch: false,
    });
    expect(r.blocking).toBe(false);
    expect(codes(r)).toContain('daily_high');
    expect(codes(r)).not.toContain('daily_cap');
  });

  it('warns when a followup runs long', () => {
    const r = checkDraft({ body: 'mot '.repeat(120), sentToday: 0, isFirstTouch: false });
    expect(codes(r)).toContain('length');
    expect(r.blocking).toBe(false);
  });

  it('uses the first-touch length window on a cold mail', () => {
    const r = checkDraft({
      body: `${'mot '.repeat(110)} https://ibanforge.com se désinscrire`,
      sentToday: 0,
      isFirstTouch: true,
    });
    expect(codes(r)).not.toContain('length');
  });

  it('warns on more than one link', () => {
    const r = checkDraft({
      body: 'Voir https://a.example.com et https://b.example.com pour la suite du dossier.',
      sentToday: 0,
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('too_many_links');
  });

  it('warns when a cold mail has no opt-out', () => {
    const r = checkDraft({ body: wordsBody(100), sentToday: 0, isFirstTouch: true });
    expect(codes(r)).toContain('no_optout');
  });

  it('does not require an opt-out on a followup', () => {
    const r = checkDraft({
      body: 'Une relance courte et polie qui pose une question.',
      sentToday: 0,
      isFirstTouch: false,
    });
    expect(codes(r)).not.toContain('no_optout');
  });

  it('warns on a spam word', () => {
    const r = checkDraft({
      body: 'Offre gratuite garantie sans engagement, cliquez vite pour en profiter maintenant.',
      sentToday: 0,
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('spam_word');
  });

  it('accepts the clean cold template', () => {
    const r = checkDraft({ body: cleanColdMail, sentToday: 0, isFirstTouch: true });
    expect(r.issues).toEqual([]);
    expect(r.blocking).toBe(false);
  });
});

describe('the daily cap boundary', () => {
  const body = 'Une relance courte et polie qui pose une question.';

  it('warns from eight and blocks at ten', () => {
    // The tests below are written against the constants, which pins the
    // comparison but not the numbers: move both to 5 and 7 and every one of
    // them still passes. This is the line that pins the policy itself, and it
    // belongs here rather than next to the constants, because it is this module
    // that turns those two numbers into a warning and a locked send button.
    expect([SOFT_CAP, HARD_CAP]).toEqual([8, 10]);
  });

  it('says nothing one send below the soft cap', () => {
    const r = checkDraft({ body, sentToday: SOFT_CAP - 1, isFirstTouch: false });
    expect(codes(r)).not.toContain('daily_high');
    expect(codes(r)).not.toContain('daily_cap');
  });

  it('still only warns one send below the hard cap', () => {
    // The gap between the two thresholds has to stay a warning tier. Slide the
    // blocking test down by one and the operator loses the last two sends.
    const r = checkDraft({ body, sentToday: HARD_CAP - 1, isFirstTouch: false });
    expect(codes(r)).toContain('daily_high');
    expect(codes(r)).not.toContain('daily_cap');
    expect(r.blocking).toBe(false);
  });

  it('keeps blocking past the hard cap', () => {
    // Guards against an equality test where a threshold is meant.
    const r = checkDraft({ body, sentToday: HARD_CAP + 5, isFirstTouch: false });
    expect(codes(r)).toContain('daily_cap');
    expect(r.blocking).toBe(true);
  });

  it('reports the count and the cap so the operator can judge', () => {
    const r = checkDraft({ body, sentToday: HARD_CAP, isFirstTouch: false });
    const message = r.issues.find((i) => i.code === 'daily_cap')?.message ?? '';
    expect(message).toContain(String(HARD_CAP));
  });
});

describe('the length windows', () => {
  it('warns just under the followup minimum and stops at it', () => {
    expect(codes(checkDraft({ body: wordsBody(39), sentToday: 0, isFirstTouch: false }))).toContain('length');
    expect(codes(checkDraft({ body: wordsBody(40), sentToday: 0, isFirstTouch: false }))).not.toContain('length');
  });

  it('is silent at the followup maximum and warns one word past it', () => {
    expect(codes(checkDraft({ body: wordsBody(90), sentToday: 0, isFirstTouch: false }))).not.toContain('length');
    expect(codes(checkDraft({ body: wordsBody(91), sentToday: 0, isFirstTouch: false }))).toContain('length');
  });

  it('warns just under the first-touch minimum and stops at it', () => {
    expect(codes(checkDraft({ body: wordsBody(89), sentToday: 0, isFirstTouch: true }))).toContain('length');
    expect(codes(checkDraft({ body: wordsBody(90), sentToday: 0, isFirstTouch: true }))).not.toContain('length');
  });

  it('is silent at the first-touch maximum and warns one word past it', () => {
    expect(codes(checkDraft({ body: wordsBody(140), sentToday: 0, isFirstTouch: true }))).not.toContain('length');
    expect(codes(checkDraft({ body: wordsBody(141), sentToday: 0, isFirstTouch: true }))).toContain('length');
  });

  it('reads a long body as fine cold and too long as a followup', () => {
    // Same 99 words either way. Only the flag moves, so an implementation that
    // ignores isFirstTouch, or that swaps the two windows, dies here.
    const long = { body: cleanColdMail, sentToday: 0 };
    expect(codes(checkDraft({ ...long, isFirstTouch: true }))).not.toContain('length');
    expect(codes(checkDraft({ ...long, isFirstTouch: false }))).toContain('length');
  });

  it('reads a short body as fine as a followup and too short cold', () => {
    // The mirror image, 60 words. Together the two pin the window both ways up.
    const short = { body: cleanFollowup, sentToday: 0 };
    expect(codes(checkDraft({ ...short, isFirstTouch: false }))).not.toContain('length');
    expect(codes(checkDraft({ ...short, isFirstTouch: true }))).toContain('length');
  });

  it('counts words, not characters', () => {
    const r = checkDraft({ body: wordsBody(50), sentToday: 0, isFirstTouch: false });
    // 50 words is 199 characters. A character-based window would misfire.
    expect(codes(r)).not.toContain('length');
  });

  it('says nothing about the length of an empty body', () => {
    // Documented, and deliberately so: answering "0 mots, la cible est 40-90"
    // to someone who has not started typing is noise on every new draft.
    //
    // The consequence is worth spelling out for Task 11, which gates the send
    // button on `blocking`: an empty followup produces no issue at all and is
    // therefore sendable as far as this module is concerned. Emptiness is the
    // composer's business, not a guardrail. A cold draft is not quite in the
    // same position, since the opt-out rule has no such exemption.
    const emptyFollowup = checkDraft({ body: '', sentToday: 0, isFirstTouch: false });
    expect(emptyFollowup.issues).toEqual([]);
    expect(emptyFollowup.blocking).toBe(false);

    const blankColdMail = checkDraft({ body: '   \n  ', sentToday: 0, isFirstTouch: true });
    expect(codes(blankColdMail)).toEqual(['no_optout']);
    expect(blankColdMail.blocking).toBe(false);
  });
});

describe('link counting', () => {
  it('accepts one link and warns on the second', () => {
    const one = 'Le détail est ici https://a.example.com si vous voulez le lire.';
    expect(codes(checkDraft({ body: one, sentToday: 0, isFirstTouch: false }))).not.toContain(
      'too_many_links',
    );
    expect(
      codes(checkDraft({ body: `${one} Et là https://b.example.com.`, sentToday: 0, isFirstTouch: false })),
    ).toContain('too_many_links');
  });

  it('counts plain http links too', () => {
    const r = checkDraft({
      body: 'Voir http://a.example.com et http://b.example.com pour la suite.',
      sentToday: 0,
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('too_many_links');
  });

  it('does not count a bare domain with no scheme', () => {
    // Written-out domains are how a mail cites a site without linking it. They
    // do not carry the deliverability cost a real link does.
    const r = checkDraft({
      body: 'Voir a.example.com et b.example.com pour la suite du dossier.',
      sentToday: 0,
      isFirstTouch: false,
    });
    expect(codes(r)).not.toContain('too_many_links');
  });

  it('does not count a scheme with nothing behind it', () => {
    const r = checkDraft({
      body: 'Le lien https:// est resté vide, et https:// aussi, dans ce brouillon.',
      sentToday: 0,
      isFirstTouch: false,
    });
    expect(codes(r)).not.toContain('too_many_links');
  });
});

describe('the opt-out rule', () => {
  it('is satisfied by an opt-out sentence on the same cold body', () => {
    // Twin of the briefed cold-mail test: only the closing sentence changes.
    const r = checkDraft({
      body: `${wordsBody(100)}. Répondez pour ne plus recevoir de message.`,
      sentToday: 0,
      isFirstTouch: true,
    });
    expect(codes(r)).not.toContain('no_optout');
  });

  it('accepts the English wording as well', () => {
    const r = checkDraft({
      body: `${wordsBody(100)}. Reply to unsubscribe.`,
      sentToday: 0,
      isFirstTouch: true,
    });
    expect(codes(r)).not.toContain('no_optout');
  });
});

describe('spam words', () => {
  it('reports one issue even when several words match', () => {
    // One flag per draft. Seven lines of red for one bad sentence is noise, and
    // noise is what makes an operator stop reading the panel.
    const r = checkDraft({
      body: 'Offre gratuite et garantie, cliquez ici, act now, limited time.',
      sentToday: 0,
      isFirstTouch: false,
    });
    expect(codes(r).filter((c) => c === 'spam_word')).toHaveLength(1);
  });

  it('matches whatever the case', () => {
    const r = checkDraft({
      body: 'CLIQUEZ pour recevoir la suite du dossier dès aujourd’hui.',
      sentToday: 0,
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('spam_word');
  });

  it('names the word it caught', () => {
    const r = checkDraft({
      body: 'Une relance avec un mot gratuit glissé dedans, sans autre défaut.',
      sentToday: 0,
      isFirstTouch: false,
    });
    expect(r.issues.find((i) => i.code === 'spam_word')?.message).toContain('gratuit');
  });
});

describe('the report', () => {
  it('keeps the warnings next to a blocking issue', () => {
    // The panel shows everything at once. A blocking issue must not swallow the
    // rest, or the operator fixes the em dash and meets the next rule blind.
    const r = checkDraft({
      body: `Offre gratuite ${EM_DASH} cliquez vite.`,
      sentToday: 0,
      isFirstTouch: false,
    });
    expect(r.blocking).toBe(true);
    expect(codes(r)).toContain('em_dash');
    expect(codes(r)).toContain('spam_word');
    expect(r.issues.filter((i) => i.level === 'warning').length).toBeGreaterThan(0);
  });

  it('is blocking only when an issue is', () => {
    const warned = checkDraft({ body: wordsBody(200), sentToday: SOFT_CAP, isFirstTouch: false });
    expect(warned.issues.length).toBeGreaterThan(0);
    expect(warned.issues.every((i) => i.level === 'warning')).toBe(true);
    expect(warned.blocking).toBe(false);
  });

  it('never writes an em dash in its own messages', () => {
    // The module forbids a character it would be absurd to ship inside its own
    // interface text. Two calls because daily_cap and daily_high are exclusive,
    // so the seven codes cannot all appear at once.
    const body = `Offre gratuite ${EM_DASH} voir https://a.example.com et https://b.example.com.`;
    const capped = checkDraft({ body, sentToday: HARD_CAP, isFirstTouch: true });
    const high = checkDraft({ body, sentToday: SOFT_CAP, isFirstTouch: true });
    const all = [...capped.issues, ...high.issues];

    expect(new Set(all.map((i) => i.code))).toEqual(
      new Set(['em_dash', 'daily_cap', 'daily_high', 'length', 'too_many_links', 'no_optout', 'spam_word']),
    );
    for (const issue of all) {
      expect(issue.message).not.toContain(EM_DASH);
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });
});
