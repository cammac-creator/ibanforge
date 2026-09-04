import { describe, expect, it } from 'vitest';
import { BLOCK_LABEL, checkDraft, type CheckInput } from './guardrails';
import { HARD_CAP, SOFT_CAP } from './sent-today';
import type { GuardrailIssue } from './types';

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
    const r = checkDraft({
      body: cleanFollowup,
      sentToday: 2,
      intent: 'outbound',
      isFirstTouch: false,
    });
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
    const r = checkDraft({
      body: `Bonjour ${EM_DASH} voici la suite.`,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(r.blocking).toBe(true);
    expect(codes(r)).toContain('em_dash');
  });

  it('does not mistake a hyphen for an em dash', () => {
    // The rule is about U+2014, the character that reads as a machine wrote the
    // sentence. A hyphen is ordinary French and appears in most mails.
    const r = checkDraft({
      body: 'Dites-moi si ce rendez-vous vous convient.',
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).not.toContain('em_dash');
    expect(r.blocking).toBe(false);
  });

  it('blocks at the hard daily cap', () => {
    const r = checkDraft({
      body: 'Une relance courte et polie qui pose une question.',
      sentToday: HARD_CAP,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(r.blocking).toBe(true);
    expect(codes(r)).toContain('daily_cap');
  });

  it('warns but does not block from the soft cap', () => {
    const r = checkDraft({
      body: 'Une relance courte et polie qui pose une question.',
      sentToday: SOFT_CAP,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(r.blocking).toBe(false);
    expect(codes(r)).toContain('daily_high');
    expect(codes(r)).not.toContain('daily_cap');
  });

  it('warns when a followup runs long', () => {
    const r = checkDraft({
      body: 'mot '.repeat(120),
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('length');
    expect(r.blocking).toBe(false);
  });

  it('uses the first-touch length window on a cold mail', () => {
    const r = checkDraft({
      body: `${'mot '.repeat(110)} https://ibanforge.com se désinscrire`,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: true,
    });
    expect(codes(r)).not.toContain('length');
  });

  it('warns on more than one link', () => {
    const r = checkDraft({
      body: 'Voir https://a.example.com et https://b.example.com pour la suite du dossier.',
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('too_many_links');
    // Warns, as the name says. Without this the severity is pinned by nothing
    // and a two-link mail could silently become unsendable-without-override.
    expect(r.blocking).toBe(false);
  });

  it('warns when a cold mail has no opt-out', () => {
    const r = checkDraft({
      body: wordsBody(100),
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: true,
    });
    expect(codes(r)).toContain('no_optout');
  });

  it('takes STOP as an opt-out only as a whole word', () => {
    const base = { sentToday: 0, intent: 'outbound' as const, isFirstTouch: true };
    expect(
      codes(checkDraft({ ...base, body: `${wordsBody(95)} Reply STOP to hear no more.` })),
    ).not.toContain('no_optout');
    expect(
      codes(checkDraft({ ...base, body: `${wordsBody(95)} We stopped guessing BICs.` })),
    ).toContain('no_optout');
  });

  it('warns when the mail proposes a call, in any of the desk languages, and never blocks', () => {
    const base = { sentToday: 0, intent: 'outbound' as const, isFirstTouch: false };
    const r = checkDraft({ ...base, body: 'Happy to jump on a call next week if that helps.' });
    expect(codes(r)).toContain('phone_call');
    expect(r.blocking).toBe(false);
    expect(
      codes(checkDraft({ ...base, body: 'Je vous propose un appel de quinze minutes.' })),
    ).toContain('phone_call');
    expect(
      codes(
        checkDraft({
          ...base,
          body: 'The BIC comes from the register; the calling code is unrelated.',
        }),
      ),
    ).not.toContain('phone_call');
  });

  it('does not require an opt-out on a followup', () => {
    const r = checkDraft({
      body: 'Une relance courte et polie qui pose une question.',
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).not.toContain('no_optout');
  });

  it('warns on a spam word', () => {
    const r = checkDraft({
      body: 'Offre gratuite garantie sans engagement, cliquez vite pour en profiter maintenant.',
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('spam_word');
    // Same reason: a mail containing an ordinary banking word must not lock the
    // send button because nobody pinned this severity.
    expect(r.blocking).toBe(false);
  });

  it('accepts the clean cold template', () => {
    const r = checkDraft({
      body: cleanColdMail,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: true,
    });
    expect(r.issues).toEqual([]);
    expect(r.blocking).toBe(false);
  });
});

describe('the daily cap boundary', () => {
  const body = 'Une relance courte et polie qui pose une question.';

  it('warns from eight and blocks at ten', () => {
    // Literal 8 and 10, not the constants. Every other test here is written
    // against SOFT_CAP and HARD_CAP, which pins the comparison but not the
    // numbers: move both to 5 and 7 and they all still pass. This is the test
    // that pins the policy, so it states it in full rather than asserting the
    // two constants and calling it done, which is the same defect it is here to
    // close. It belongs in this suite because it is this module that turns
    // those two numbers into a warning and a locked send button.
    const atEight = checkDraft({ body, sentToday: 8, intent: 'outbound', isFirstTouch: false });
    expect(codes(atEight)).toContain('daily_high');
    expect(atEight.blocking).toBe(false);

    const atTen = checkDraft({ body, sentToday: 10, intent: 'outbound', isFirstTouch: false });
    expect(codes(atTen)).toContain('daily_cap');
    expect(atTen.blocking).toBe(true);

    expect([SOFT_CAP, HARD_CAP]).toEqual([8, 10]);
  });

  it('says nothing one send below the soft cap', () => {
    const r = checkDraft({
      body,
      sentToday: SOFT_CAP - 1,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).not.toContain('daily_high');
    expect(codes(r)).not.toContain('daily_cap');
  });

  it('still only warns one send below the hard cap', () => {
    // The gap between the two thresholds has to stay a warning tier. Slide the
    // blocking test down by one and the operator loses the last two sends.
    const r = checkDraft({
      body,
      sentToday: HARD_CAP - 1,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('daily_high');
    expect(codes(r)).not.toContain('daily_cap');
    expect(r.blocking).toBe(false);
  });

  it('keeps blocking past the hard cap', () => {
    // Guards against an equality test where a threshold is meant.
    const r = checkDraft({
      body,
      sentToday: HARD_CAP + 5,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('daily_cap');
    expect(r.blocking).toBe(true);
  });

  it('reports the count and the cap so the operator can judge', () => {
    const r = checkDraft({ body, sentToday: HARD_CAP, intent: 'outbound', isFirstTouch: false });
    const message = r.issues.find((i) => i.code === 'daily_cap')?.message ?? '';
    expect(message).toContain(String(HARD_CAP));
  });
});

describe('the length windows', () => {
  it('warns just under the followup minimum and stops at it', () => {
    expect(
      codes(
        checkDraft({ body: wordsBody(39), sentToday: 0, intent: 'outbound', isFirstTouch: false }),
      ),
    ).toContain('length');
    expect(
      codes(
        checkDraft({ body: wordsBody(40), sentToday: 0, intent: 'outbound', isFirstTouch: false }),
      ),
    ).not.toContain('length');
  });

  it('is silent at the followup maximum and warns one word past it', () => {
    expect(
      codes(
        checkDraft({ body: wordsBody(90), sentToday: 0, intent: 'outbound', isFirstTouch: false }),
      ),
    ).not.toContain('length');
    expect(
      codes(
        checkDraft({ body: wordsBody(91), sentToday: 0, intent: 'outbound', isFirstTouch: false }),
      ),
    ).toContain('length');
  });

  it('warns just under the first-touch minimum and stops at it', () => {
    expect(
      codes(
        checkDraft({ body: wordsBody(89), sentToday: 0, intent: 'outbound', isFirstTouch: true }),
      ),
    ).toContain('length');
    expect(
      codes(
        checkDraft({ body: wordsBody(90), sentToday: 0, intent: 'outbound', isFirstTouch: true }),
      ),
    ).not.toContain('length');
  });

  it('is silent at the first-touch maximum and warns one word past it', () => {
    expect(
      codes(
        checkDraft({ body: wordsBody(140), sentToday: 0, intent: 'outbound', isFirstTouch: true }),
      ),
    ).not.toContain('length');
    expect(
      codes(
        checkDraft({ body: wordsBody(141), sentToday: 0, intent: 'outbound', isFirstTouch: true }),
      ),
    ).toContain('length');
  });

  it('reads a long body as fine cold and too long as a followup', () => {
    // Same 99 words either way. Only the flag moves, so an implementation that
    // ignores isFirstTouch, or that swaps the two windows, dies here.
    const long = { body: cleanColdMail, sentToday: 0 };
    expect(codes(checkDraft({ ...long, intent: 'outbound', isFirstTouch: true }))).not.toContain(
      'length',
    );
    expect(codes(checkDraft({ ...long, intent: 'outbound', isFirstTouch: false }))).toContain(
      'length',
    );
  });

  it('reads a short body as fine as a followup and too short cold', () => {
    // The mirror image, 60 words. Together the two pin the window both ways up.
    const short = { body: cleanFollowup, sentToday: 0 };
    expect(codes(checkDraft({ ...short, intent: 'outbound', isFirstTouch: false }))).not.toContain(
      'length',
    );
    expect(codes(checkDraft({ ...short, intent: 'outbound', isFirstTouch: true }))).toContain(
      'length',
    );
  });

  it('counts words, not characters', () => {
    const r = checkDraft({
      body: wordsBody(50),
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    // 50 words is 199 characters. A character-based window would misfire.
    expect(codes(r)).not.toContain('length');
  });

  it('says nothing about the length of an empty body', () => {
    // The length rule alone abstains, and deliberately so: answering "0 mots,
    // la cible est 40-90" to someone who has not started typing is noise on
    // every new draft.
    //
    // Emptiness itself is no longer passed over. It used to be left to the
    // composer, on the reading that a blank draft is not a rule's business, and
    // the empty followup below produced no issue at all. `empty_body` now
    // blocks it in both intentions, because a reply sheet that opens focused
    // makes a stray Enter send nothing at all. So what is pinned here is the
    // division of labour: the word window stays silent, and the block that
    // takes the send away comes from the rule written for it.
    const emptyFollowup = checkDraft({
      body: '',
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(emptyFollowup)).not.toContain('length');
    expect(codes(emptyFollowup)).toEqual(['empty_body']);
    expect(emptyFollowup.blocking).toBe(true);

    const blankColdMail = checkDraft({
      body: '   \n  ',
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: true,
    });
    expect(codes(blankColdMail)).not.toContain('length');
    expect(codes(blankColdMail)).toEqual(['empty_body', 'no_optout']);
  });
});

describe('link counting', () => {
  it('accepts one link and warns on the second', () => {
    const one = 'Le détail est ici https://a.example.com si vous voulez le lire.';
    expect(
      codes(checkDraft({ body: one, sentToday: 0, intent: 'outbound', isFirstTouch: false })),
    ).not.toContain('too_many_links');
    expect(
      codes(
        checkDraft({
          body: `${one} Et là https://b.example.com.`,
          sentToday: 0,
          intent: 'outbound',
          isFirstTouch: false,
        }),
      ),
    ).toContain('too_many_links');
  });

  it('counts plain http links too', () => {
    const r = checkDraft({
      body: 'Voir http://a.example.com et http://b.example.com pour la suite.',
      sentToday: 0,
      intent: 'outbound',
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
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).not.toContain('too_many_links');
  });

  it('does not count a scheme with nothing behind it', () => {
    const r = checkDraft({
      body: 'Le lien https:// est resté vide, et https:// aussi, dans ce brouillon.',
      sentToday: 0,
      intent: 'outbound',
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
      intent: 'outbound',
      isFirstTouch: true,
    });
    expect(codes(r)).not.toContain('no_optout');
  });

  it('accepts the English wording as well', () => {
    const r = checkDraft({
      body: `${wordsBody(100)}. Reply to unsubscribe.`,
      sentToday: 0,
      intent: 'outbound',
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
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r).filter((c) => c === 'spam_word')).toHaveLength(1);
  });

  it('matches whatever the case', () => {
    const r = checkDraft({
      body: 'CLIQUEZ pour recevoir la suite du dossier dès aujourd’hui.',
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('spam_word');
  });

  it('names the word it caught', () => {
    const r = checkDraft({
      body: 'Une relance avec un mot gratuit glissé dedans, sans autre défaut.',
      sentToday: 0,
      intent: 'outbound',
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
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(r.blocking).toBe(true);
    expect(codes(r)).toContain('em_dash');
    expect(codes(r)).toContain('spam_word');
    expect(r.issues.filter((i) => i.level === 'warning').length).toBeGreaterThan(0);
  });

  it('is blocking only when an issue is', () => {
    const warned = checkDraft({
      body: wordsBody(200),
      sentToday: SOFT_CAP,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(warned.issues.length).toBeGreaterThan(0);
    expect(warned.issues.every((i) => i.level === 'warning')).toBe(true);
    expect(warned.blocking).toBe(false);
  });

  it('never writes an em dash in its own messages', () => {
    // The module forbids a character it would be absurd to ship inside its own
    // interface text. Three calls because the codes cannot all appear at once:
    // daily_cap and daily_high are exclusive, and empty_body needs a body that
    // no other rule here can read. A code reachable by none of the three would
    // ship its message unswept, which is why the set is asserted before the
    // loop rather than trusted.
    const body = `Offre gratuite ${EM_DASH} voir https://a.example.com et https://b.example.com.`;
    const capped = checkDraft({
      body,
      sentToday: HARD_CAP,
      intent: 'outbound',
      isFirstTouch: true,
    });
    const high = checkDraft({ body, sentToday: SOFT_CAP, intent: 'outbound', isFirstTouch: true });
    const blank = checkDraft({
      body: '   ',
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    const all = [...capped.issues, ...high.issues, ...blank.issues];

    expect(new Set(all.map((i) => i.code))).toEqual(
      new Set([
        'em_dash',
        'empty_body',
        'daily_cap',
        'daily_high',
        'length',
        'too_many_links',
        'no_optout',
        'spam_word',
      ]),
    );
    for (const issue of all) {
      expect(issue.message).not.toContain(EM_DASH);
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });

  /**
   * The severity of every code, in one table.
   *
   * Two of these were pinned by nothing until a review went looking: flipping
   * `too_many_links` or `spam_word` to blocking left the whole suite green. The
   * lesson is not "add two assertions", it is that a per-rule test tends to
   * check the rule fired and forget what it costs, so the class is covered here
   * rather than one instance at a time. Task 11 turns `blocking` into a locked
   * send button, which is what makes this the load-bearing column.
   */
  const SEVERITIES: Array<[GuardrailIssue['code'], GuardrailIssue['level'], CheckInput]> = [
    [
      'em_dash',
      'blocking',
      {
        body: `Bonjour ${EM_DASH} la suite.`,
        sentToday: 0,
        intent: 'outbound',
        isFirstTouch: false,
      },
    ],
    [
      'daily_cap',
      'blocking',
      { body: cleanFollowup, sentToday: HARD_CAP, intent: 'outbound', isFirstTouch: false },
    ],
    [
      'daily_high',
      'warning',
      { body: cleanFollowup, sentToday: SOFT_CAP, intent: 'outbound', isFirstTouch: false },
    ],
    [
      'length',
      'warning',
      { body: wordsBody(5), sentToday: 0, intent: 'outbound', isFirstTouch: false },
    ],
    [
      'too_many_links',
      'warning',
      {
        body: `${cleanFollowup} https://a.example.com https://b.example.com`,
        sentToday: 0,
        intent: 'outbound',
        isFirstTouch: false,
      },
    ],
    [
      'no_optout',
      'warning',
      { body: wordsBody(100), sentToday: 0, intent: 'outbound', isFirstTouch: true },
    ],
    [
      'spam_word',
      'warning',
      { body: `${cleanFollowup} gratuit`, sentToday: 0, intent: 'outbound', isFirstTouch: false },
    ],
  ];

  for (const [code, level, input] of SEVERITIES) {
    it(`reports ${code} as ${level}`, () => {
      const issue = checkDraft(input).issues.find((i) => i.code === code);
      expect(issue, `${code} did not fire on its own fixture`).toBeDefined();
      expect(issue?.level).toBe(level);
    });
  }
});

describe('the subject line', () => {
  /**
   * The composer holds a subject and fills it from the same generator that
   * writes the body, so until now the model wrote one line that no rule ever
   * read. It is also the line most certain to be read by the recipient, and the
   * field spam filters weigh hardest.
   *
   * Only two rules widen to it, deliberately. A subject is not prose: counting
   * its words would distort a window tuned for a mail, its link would not be a
   * link in the body, and an opt-out belongs in the closing, not the header.
   */
  const coldBody = `${wordsBody(100)}. Répondez pour ne plus recevoir de message.`;

  it('blocks on an em dash in the subject alone', () => {
    const r = checkDraft({
      subject: `Votre API bancaire ${EM_DASH} une question`,
      body: cleanFollowup,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('em_dash');
    expect(r.blocking).toBe(true);
  });

  it('warns on a spam word in the subject alone', () => {
    const r = checkDraft({
      subject: 'Offre gratuite pour vous',
      body: cleanFollowup,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('spam_word');
    expect(r.blocking).toBe(false);
  });

  it('changes nothing when the subject is clean', () => {
    const r = checkDraft({
      subject: 'Une question sur vos coordonnées bancaires',
      body: cleanFollowup,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(r.issues).toEqual([]);
  });

  it('behaves exactly as before when the subject is omitted', () => {
    // Task 11 has to be able to adopt this without a flag day, so the two calls
    // must be indistinguishable.
    const withoutSubject = checkDraft({
      body: cleanColdMail,
      sentToday: SOFT_CAP,
      intent: 'outbound',
      isFirstTouch: true,
    });
    const withClean = checkDraft({
      subject: 'Une question',
      body: cleanColdMail,
      sentToday: SOFT_CAP,
      intent: 'outbound',
      isFirstTouch: true,
    });
    expect(withClean).toEqual(withoutSubject);
  });

  it('does not count the subject in the word window', () => {
    // The body sits exactly on the followup maximum. A subject folded into the
    // count would push it over and warn.
    const r = checkDraft({
      subject: wordsBody(50),
      body: wordsBody(90),
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).not.toContain('length');
  });

  it('does not count a link in the subject', () => {
    const r = checkDraft({
      subject: 'Voir https://a.example.com',
      body: `${cleanFollowup} https://b.example.com`,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).not.toContain('too_many_links');
  });

  it('does not let the subject satisfy the opt-out rule', () => {
    // An opt-out in the header is not an opt-out. It belongs in the closing.
    const r = checkDraft({
      subject: 'Se désinscrire',
      body: wordsBody(100),
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: true,
    });
    expect(codes(r)).toContain('no_optout');
  });

  it('does not forge a spam phrase across the two fields', () => {
    // Joined with a space, a subject ending in "sans" and a body opening on
    // "engagement" would invent a match neither field contains.
    const r = checkDraft({
      subject: 'Une question sans',
      body: `engagement de votre part, ${cleanFollowup}`,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).not.toContain('spam_word');
  });

  it('still reads the body when a subject is present', () => {
    // The widening must not turn into a swap.
    const r = checkDraft({
      subject: 'Une question',
      body: `Bonjour ${EM_DASH} la suite.`,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(codes(r)).toContain('em_dash');
  });

  it('leaves the cold opt-out rule reading the body', () => {
    const r = checkDraft({
      subject: 'Une question',
      body: coldBody,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: true,
    });
    expect(codes(r)).not.toContain('no_optout');
  });
});

describe('the length message', () => {
  it('says one mot, not one mots', () => {
    // Task 11 checks as the operator types, so the first word typed shows this
    // message on every new draft.
    const r = checkDraft({
      body: 'Bonjour',
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    const message = r.issues.find((i) => i.code === 'length')?.message ?? '';
    expect(message).toContain('1 mot.');
  });

  it('says two mots', () => {
    const r = checkDraft({
      body: 'Bonjour vous',
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    });
    expect(r.issues.find((i) => i.code === 'length')?.message ?? '').toContain('2 mots.');
  });
});

/**
 * The fourth cause of "a follow-up sends back the mail already sent": nothing
 * between the text and the send button ever compared the two. The measure is
 * pinned in repeat.test.ts; what is pinned here is the reading of it, and above
 * all that it never blocks.
 */
describe('the repeat of the last mail sent', () => {
  const sent = `Bonjour,

Je construis une petite interface qui vérifie un identifiant bancaire, retrouve l'établissement correspondant et renvoie le tout en une seule requête, sans aucune base à maintenir de votre côté.

Votre équipe publie des intégrations de facturation, et la saisie des coordonnées bancaires y revient sans cesse. Je peux vous montrer le résultat sur vos propres données en quelques minutes, quand cela vous arrange.

Si le sujet ne vous parle pas, dites-le moi franchement et je ne reviendrai pas dessus.

Bien à vous,
Claude-Alain`;

  const previous = { subject: 'Vérification des coordonnées bancaires', text: sent };

  it('warns when the draft is the mail already sent', () => {
    const r = checkDraft({
      body: sent,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
      previous,
    });
    expect(codes(r)).toContain('repeat_previous');
  });

  it('never blocks on it, whatever the resemblance', () => {
    // The hard requirement of this rule. Resending a close text is an editorial
    // call the owner is entitled to make, unlike an em dash or the daily cap,
    // which are promises to the domain's reputation.
    const r = checkDraft({
      body: sent,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
      previous,
    });
    expect(r.issues.find((i) => i.code === 'repeat_previous')?.level).toBe('warning');
    expect(r.blocking).toBe(false);
  });

  it('says how much of the text is old, and what to do about it', () => {
    const r = checkDraft({
      body: sent,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
      previous,
    });
    const message = r.issues.find((i) => i.code === 'repeat_previous')?.message ?? '';
    expect(message).toContain('100 %');
    // An instruction, not only a diagnosis.
    expect(message).toContain('Coupe');
    expect(message).not.toContain(EM_DASH);
  });

  it('rounds the figure rather than printing false precision', () => {
    // Most of the mail already sent, followed by a paragraph that owes it
    // nothing: 0.87, printed as 90 %. A figure to the percent would read as a
    // measurement, and this is a reading of a set overlap that moves on a
    // comma. It also has to be a value other than 100, or a hard-coded
    // "Environ 100 %" would pass every test above.
    const half = `${sent.slice(0, 480)}\n\nUne idée toute neuve, écrite pour ce mail seulement, qui ne doit rien à ce qui précède et qui rallonge le texte sans le répéter du tout aujourd'hui.`;
    const message =
      checkDraft({
        body: half,
        sentToday: 0,
        intent: 'outbound',
        isFirstTouch: false,
        previous,
      }).issues.find((i) => i.code === 'repeat_previous')?.message ?? '';
    expect(message).toMatch(/Environ \d0 %/);
  });

  it('fires exactly at the threshold, not one step past it', () => {
    // Built to land on 0.5 on the nose rather than described as landing there.
    // The previous mail is 40 distinct words, so 38 trigrams. The draft opens
    // on its first 21 words and then says 21 words of its own: 42 words, 40
    // trigrams, of which the 19 lying wholly inside that opening are shared.
    // The trigram straddling the seam is not. 19 over min(40, 38) is one half.
    const older = Array.from({ length: 40 }, (_, i) => `ancien${i}`).join(' ');
    const draft = [
      ...Array.from({ length: 21 }, (_, i) => `ancien${i}`),
      ...Array.from({ length: 21 }, (_, i) => `nouveau${i}`),
    ].join(' ');
    const r = checkDraft({
      body: draft,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
      previous: { subject: null, text: older },
    });
    expect(codes(r)).toContain('repeat_previous');
    expect(r.issues.find((i) => i.code === 'repeat_previous')?.message).toContain('50 %');
  });

  it('stays quiet on a follow-up that shares only the greeting, the closing and the signature', () => {
    const genuine = `Bonjour,

Combien de temps votre support passe-t-il chaque semaine à corriger un numéro de compte mal saisi ? Si la réponse dépasse dix minutes, je crois avoir de quoi vous aider très vite.

Si le sujet ne vous parle pas, dites-le moi franchement et je ne reviendrai pas dessus.

Bien à vous,
Claude-Alain`;
    const r = checkDraft({
      body: genuine,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
      previous,
    });
    expect(codes(r)).not.toContain('repeat_previous');
  });

  it('says nothing when the pair is too short to be judged', () => {
    // Found by the mutation sweep: reading an abstention as a repeat put
    // "Environ 0 %" on screen, which is a warning about nothing and the fastest
    // way to teach the operator to stop reading the panel. Abstaining is not
    // the same answer as "no repetition" and must not be printed as one.
    const tiny = 'Trop court pour être jugé.';
    const r = checkDraft({
      body: tiny,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
      previous: { subject: null, text: tiny },
    });
    expect(codes(r)).not.toContain('repeat_previous');
  });

  it('says nothing at all when there is no previous mail', () => {
    // The default, and what keeps every other test in this file unchanged.
    const r = checkDraft({ body: sent, sentToday: 0, intent: 'outbound', isFirstTouch: false });
    expect(codes(r)).not.toContain('repeat_previous');
    expect(codes(r)).not.toContain('same_subject');
  });

  it('warns on a subject identical to the last one sent', () => {
    const r = checkDraft({
      subject: 'Vérification des coordonnées bancaires',
      body: cleanFollowup,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
      previous,
    });
    const issue = r.issues.find((i) => i.code === 'same_subject');
    expect(issue?.level).toBe('warning');
    expect(issue?.message).not.toContain(EM_DASH);
    expect(r.blocking).toBe(false);
  });

  it('says nothing about a subject that says something else', () => {
    const r = checkDraft({
      subject: 'Une question que je ne vous ai pas posée',
      body: cleanFollowup,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
      previous,
    });
    expect(codes(r)).not.toContain('same_subject');
  });

  it('says nothing about an empty subject', () => {
    // A draft being written has no subject yet, and neither does one saved from
    // a generation that returned none. Neither is a duplicate.
    const r = checkDraft({
      subject: '  ',
      body: cleanFollowup,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
      previous,
    });
    expect(codes(r)).not.toContain('same_subject');
  });

  it('raises the two of them at once when both are true, and still does not block', () => {
    const r = checkDraft({
      subject: 'Vérification des coordonnées bancaires',
      body: sent,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
      previous,
    });
    expect(codes(r)).toContain('repeat_previous');
    expect(codes(r)).toContain('same_subject');
    expect(r.blocking).toBe(false);
  });

  it('leaves the blocking rules blocking when a repeat carries one', () => {
    // The warning must not soften what sits beside it.
    const r = checkDraft({
      body: `${sent} ${EM_DASH}`,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
      previous,
    });
    expect(codes(r)).toContain('repeat_previous');
    expect(r.blocking).toBe(true);
  });
});

/**
 * The override control names what it is being clicked against, and it reads
 * those names out of BLOCK_LABEL. A blocking rule missing from that map puts a
 * raw code such as `daily_cap` on a button in front of the operator.
 *
 * Written as a sweep over drafts that raise every rule rather than as a list of
 * codes copied from the source: a list copied from the source agrees with the
 * source by construction, and would still agree the day a warning is promoted
 * to a block.
 */
describe('the names the override button reads', () => {
  const previous = { subject: 'Un objet déjà utilisé', text: cleanColdMail };

  /** One draft per rule, enough between them to raise all ten. */
  const battery: CheckInput[] = [
    { body: `Bonjour ${EM_DASH} la suite.`, sentToday: 0, intent: 'outbound', isFirstTouch: false },
    { body: '', sentToday: 0, intent: 'outbound', isFirstTouch: false },
    { body: cleanFollowup, sentToday: HARD_CAP, intent: 'outbound', isFirstTouch: false },
    { body: cleanFollowup, sentToday: SOFT_CAP, intent: 'outbound', isFirstTouch: false },
    { body: wordsBody(3), sentToday: 0, intent: 'outbound', isFirstTouch: false },
    {
      body: 'https://a.example.net https://b.example.net',
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    },
    { body: cleanFollowup, sentToday: 0, intent: 'outbound', isFirstTouch: true },
    {
      body: `${cleanFollowup} C’est gratuit.`,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
    },
    {
      subject: 'Un objet déjà utilisé',
      body: cleanColdMail,
      sentToday: 0,
      intent: 'outbound',
      isFirstTouch: false,
      previous,
    },
  ];

  const raised = battery.flatMap((input) => checkDraft(input).issues);

  it('exercises every rule there is, or it proves nothing', () => {
    // The sweep is only worth what it covers, so the coverage is asserted
    // first. A rule added without a draft here would slip past the check below
    // in silence, which is the failure this test exists to prevent.
    const seen = new Set(raised.map((i) => i.code));
    expect([...seen].sort()).toEqual([
      'daily_cap',
      'daily_high',
      'em_dash',
      'empty_body',
      'length',
      'no_optout',
      'repeat_previous',
      'same_subject',
      'spam_word',
      'too_many_links',
    ]);
  });

  it('has a French name for every rule that takes the send away', () => {
    const blocking = [...new Set(raised.filter((i) => i.level === 'blocking').map((i) => i.code))];
    expect(blocking.length).toBeGreaterThan(0);
    for (const code of blocking) {
      expect(BLOCK_LABEL[code], `no override label for ${code}`).toBeTruthy();
    }
  });

  it('does not name the rules that only warn, since they never reach that button', () => {
    // "Only warn", not "warn": a rule that blocks under other inputs is
    // entitled to its label, so it is subtracted rather than assumed absent.
    // Without that, this test and the one above would contradict each other the
    // day a rule blocks in one case and warns in another.
    const blocking = new Set(raised.filter((i) => i.level === 'blocking').map((i) => i.code));
    const onlyWarn = [...new Set(raised.map((i) => i.code))].filter((c) => !blocking.has(c));
    for (const code of onlyWarn) {
      expect(BLOCK_LABEL[code], `${code} only warns and needs no override label`).toBeUndefined();
    }
  });
});

describe('guardrail scope by intent', () => {
  /**
   * Inputs built to trip every prospecting rule at once: a body short of the
   * cold windows yet long enough for repeatRatio to measure it (it abstains
   * under MIN_SHINGLES), three links, no opt-out, a spam word, and a previous
   * mail carrying the identical text and the identical subject. The two repeat
   * rules used to be asserted on the reply side with no `previous` and no
   * colliding subject, so those two assertions were true for reasons that had
   * nothing to do with the envelope they claim to pin.
   */
  const TRIPWIRE = [
    'Gratuit. Voir https://a.example https://b.example https://c.example pour',
    'valider des IBAN, vérifier des BIC et contrôler la conformité de vos',
    'paiements. Notre outil complète vos dossiers, réduit vos rejets bancaires',
    'et simplifie vos contrôles. Répondez à ce message pour en discuter la',
    'semaine prochaine.',
  ].join(' ');
  const SUBJECT = 'Validation IBAN pour vos paiements';
  const PREVIOUS = { subject: SUBJECT, text: TRIPWIRE };

  it('fires no prospecting rule on a reply', () => {
    // Same inputs as the outbound twin below, previous mail and colliding
    // subject included, so every not.toContain here is checked against an
    // input the twin proves would fire the rule one intent over.
    const report = checkDraft({
      body: TRIPWIRE,
      subject: SUBJECT,
      previous: PREVIOUS,
      sentToday: 99,
      isFirstTouch: true,
      intent: 'reply',
    });
    const codes = report.issues.map((i) => i.code);
    expect(codes).not.toContain('length');
    expect(codes).not.toContain('too_many_links');
    expect(codes).not.toContain('no_optout');
    expect(codes).not.toContain('spam_word');
    expect(codes).not.toContain('daily_cap');
    expect(codes).not.toContain('daily_high');
    expect(codes).not.toContain('repeat_previous');
    expect(codes).not.toContain('same_subject');
  });

  it('still fires those rules on an outbound', () => {
    const report = checkDraft({
      body: TRIPWIRE,
      subject: SUBJECT,
      previous: PREVIOUS,
      sentToday: 99,
      isFirstTouch: true,
      intent: 'outbound',
    });
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain('length');
    expect(codes).toContain('too_many_links');
    expect(codes).toContain('no_optout');
    expect(codes).toContain('spam_word');
    expect(codes).toContain('daily_cap');
    expect(codes).toContain('repeat_previous');
    expect(codes).toContain('same_subject');
  });

  it('blocks an em dash in both intentions, because that rule is about all sent prose', () => {
    for (const intent of ['reply', 'outbound'] as const) {
      const report = checkDraft({
        body: `Bonjour ${EM_DASH} merci de votre message.`,
        sentToday: 0,
        isFirstTouch: false,
        intent,
      });
      expect(report.issues.map((i) => i.code)).toContain('em_dash');
      expect(report.blocking).toBe(true);
    }
  });

  it('blocks an empty body in both intentions', () => {
    for (const intent of ['reply', 'outbound'] as const) {
      const report = checkDraft({ body: '   \n ', sentToday: 0, isFirstTouch: false, intent });
      expect(report.issues.map((i) => i.code)).toContain('empty_body');
      expect(report.blocking).toBe(true);
    }
  });

  it('gives every blocking code a short label for the override control', () => {
    // Pinned rather than left to be noticed: a blocking rule with no entry puts
    // a raw code such as `empty_body` in front of the operator.
    for (const code of ['em_dash', 'daily_cap', 'empty_body'] as const) {
      expect(BLOCK_LABEL[code]).toBeTruthy();
    }
  });
});
