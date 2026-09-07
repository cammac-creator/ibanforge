import { isAutomated } from './automated';
import type { Contact, Message } from './types';

/**
 * The three languages a draft may be written in, which is the same three the
 * site is published in. Not "any ISO code": the writing rule has to be a
 * closed set, because an instruction saying "answer in nl" to a model whose
 * mail nobody here can proofread is worse than answering in English.
 */
export type CorrespondentLang = 'en' | 'fr' | 'de';

/** The order the picker offers them in, and the order the sheet's menu shows. */
export const CORRESPONDENT_LANGS: readonly CorrespondentLang[] = ['en', 'fr', 'de'];

/** What each one is called, where a human reads it. */
export const CORRESPONDENT_LANG_LABEL: Record<CorrespondentLang, string> = {
  en: 'anglais',
  fr: 'français',
  de: 'allemand',
};

/** What each one is called where the MODEL reads it, so the prompt names a language. */
export const CORRESPONDENT_LANG_NAME: Record<CorrespondentLang, string> = {
  en: 'English',
  fr: 'French',
  de: 'German',
};

/**
 * Read a stored language tag, and refuse everything that is not one of the
 * three.
 *
 * `email_messages.lang` is free TEXT, written by the sync's own detection and
 * clipped to 8 characters by the API — so it arrives as `fr`, `FR`, `fr-CH`,
 * `de_DE`, an empty string, or something nobody planned for. The tag is folded
 * to its primary subtag and matched; anything else is `null`, which means
 * "this source has no answer" and lets the next clause speak. Null rather than
 * a silent fallback to English: the difference between "they wrote in Dutch"
 * and "nothing said" is what the clause order below is made of.
 */
export function normaliseLang(raw: string | null | undefined): CorrespondentLang | null {
  if (typeof raw !== 'string') return null;
  const primary = raw.trim().toLowerCase().split(/[-_]/)[0];
  return (CORRESPONDENT_LANGS as readonly string[]).includes(primary)
    ? (primary as CorrespondentLang)
    : null;
}

/**
 * The last message the correspondent actually wrote, robots skipped.
 *
 * Automated mail is skipped for the same reason `threadTail` and the reply
 * sheet's subject line skip it: a German out-of-office landing after an
 * English question is the newest inbound row, and without this term it would
 * decide the language of the answer to a mail written in English.
 */
function lastHumanInbound(messages: readonly Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.direction !== 'in') continue;
    if (isAutomated(m)) continue;
    return m;
  }
  return null;
}

/**
 * Which language a draft to this correspondent should be written in.
 *
 * Four clauses, in the order of how much each one actually knows about this
 * person:
 *
 *  1. **The last message they wrote us.** The strongest evidence there is:
 *     somebody who wrote in French is owed an answer in French, whatever any
 *     list says about them. Robots skipped, see above.
 *  2. **`recommended_lang` on the prospect row.** The radar wrote the
 *     pre-written mail in two languages and recorded which one it meant to
 *     send; on a prospect who has never written, that is the best guess
 *     anybody made. It only ever holds `fr` or `en` (build-contacts.ts folds
 *     everything else to `en`), so it can never be the source of a German
 *     draft — which is honest rather than a limitation to paper over.
 *  3. **The client's own language**, when the caller has one.
 *  4. **`en`.** Not a guess: it is what both draft prompts have always pinned
 *     the mail to, so falling here changes nothing about today's behaviour.
 *
 * ## On clause 3
 *
 * `clientLang` is a parameter and not a field read off the contact, because
 * **no client language exists in the payload today**: neither `ClientKeyInfo`,
 * nor the admin `keys` row, nor the `api_keys` table carries one (checked
 * 2026-09-07). Today's callers pass nothing and the clause is inert. It is
 * written anyway, and as an argument rather than as a `country` heuristic,
 * because the day a signup records its locale the change is one call site —
 * whereas guessing a language from a country would have to decide what
 * Switzerland speaks, and would be wrong for a living.
 */
export function pickCorrespondentLang(input: {
  /** The thread, oldest first, as `Contact.messages` holds it. */
  messages: readonly Message[];
  /** `recommended_lang` off the prospect row, when the contact is one. */
  recommendedLang?: string | null;
  /** The client's declared language. No source in the payload today; see above. */
  clientLang?: string | null;
}): CorrespondentLang {
  const wrote = lastHumanInbound(input.messages);
  return (
    normaliseLang(wrote?.lang) ??
    normaliseLang(input.recommendedLang) ??
    normaliseLang(input.clientLang) ??
    'en'
  );
}

/**
 * The same question asked of a whole contact, so the two writing sheets read
 * one expression instead of each assembling the inputs their own way.
 *
 * `readyMail` is reached through the union rather than through a `kind` test:
 * it exists on the prospect member only, and a client that came from the
 * prospect list carries `sourcing` but no `readyMail`.
 */
export function correspondentLangOf(c: Contact): CorrespondentLang {
  return pickCorrespondentLang({
    messages: c.messages,
    recommendedLang: c.kind === 'prospect' ? (c.readyMail?.recommendedLang ?? null) : null,
  });
}
