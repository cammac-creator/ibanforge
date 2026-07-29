import type { Message } from './types';

/**
 * Which text a draft card should show, and whether a translation exists at all.
 *
 * ## Why this is a function and not two lines of JSX
 *
 * A draft is the one message in the thread whose displayed text and whose sent
 * text are allowed to differ. Everywhere else, showing the French version is
 * cosmetic. Here, if the card ever hands the translation to the send path, the
 * customer receives French he did not ask for. So the rule is stated once,
 * tested, and the card is left with nothing to decide:
 *
 *   - `text` is for reading only.
 *   - `isTranslation` says out loud when `text` is NOT what would be sent.
 *   - The editable body stays the caller's own state and is never derived here.
 *
 * The `lang !== 'fr'` guard mirrors TimelineMessage: a draft already written in
 * French has no translation to offer, and `translate-messages.py` sometimes
 * writes the literal placeholder or 'und' when the model fails to detect, so a
 * malformed code must never light up a toggle that then shows nothing.
 */
export interface DraftReading {
  /** The text to render in the read-only view. */
  text: string;
  /** True when `text` is the translation rather than the body that would be sent. */
  isTranslation: boolean;
  /** True when a usable translation exists, so the card may offer the toggle. */
  canTranslate: boolean;
}

const VALID_LANG = /^[a-z]{2,3}$/;

export function draftReading(draft: Message, showOriginal: boolean): DraftReading {
  const body = draft.body ?? draft.snippet ?? '';
  const lang = draft.lang ?? '';
  const langUsable = VALID_LANG.test(lang) && lang !== 'und';
  const fr = draft.snippet_fr ?? '';
  const canTranslate = langUsable && lang !== 'fr' && fr.trim().length > 0;

  if (!canTranslate || showOriginal) {
    return { text: body, isTranslation: false, canTranslate };
  }
  return { text: fr, isTranslation: true, canTranslate };
}
