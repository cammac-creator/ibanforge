'use client';

import { useState } from 'react';
import {
  CORRESPONDENT_LANGS,
  CORRESPONDENT_LANG_LABEL,
  correspondentLangOf,
  type CorrespondentLang,
} from '@/lib/crm/correspondent-lang';
import type { Contact } from '@/lib/crm/types';

/**
 * The language a draft to this correspondent will be written in: what the CRM
 * worked out, and the operator's right to disagree with it.
 *
 * The rule itself is not here. It lives in lib/crm/correspondent-lang.ts,
 * pure and tested, and this hook only adds the override — which is why both
 * writing sheets can share it without either of them holding a second opinion
 * about what a French mail deserves.
 *
 * The override is component state, so it dies when the sheet is remounted on a
 * change of contact. That is the correct life for it: a language chosen for
 * one correspondent must never follow the operator to the next, exactly as
 * the text does not.
 *
 * No effect, and none needed: `chosen` starts null and the answer is derived
 * on every render. Seeding state from the detected value in an effect is what
 * the React Compiler rules name (react-hooks/set-state-in-effect), and it
 * would also freeze the detection at mount — a thread refreshed by
 * router.refresh() would keep answering with the language of the message
 * before last.
 */
export function useCorrespondentLang(c: Contact) {
  const detected = correspondentLangOf(c);
  const [chosen, setChosen] = useState<CorrespondentLang | null>(null);
  return { lang: chosen ?? detected, detected, chosen, setChosen };
}

/**
 * The pill: what language is going out, and a three-value menu to change it.
 *
 * A native `<select>`, not a custom popover. It is three values, it must be
 * reachable from the keyboard inside a sheet that already traps Escape once,
 * and the drawer's Escape handler knows SELECT as a field it should leave
 * before it closes the fiche (see contact-drawer.tsx). A hand-rolled menu
 * would have to re-earn all three.
 *
 * The label says where the answer came from, because "français" alone leaves
 * the operator unable to tell a detection they can trust from a default they
 * should override.
 */
export function LangPicker({
  lang,
  chosen,
  onChange,
  id,
}: {
  lang: CorrespondentLang;
  /** Null while the CRM's own answer stands. */
  chosen: CorrespondentLang | null;
  onChange: (lang: CorrespondentLang) => void;
  /** Unique per surface: two sheets sharing one id would collide on the label. */
  id: string;
}) {
  const source = chosen ? 'choisie à la main' : 'déduite du fil et de la fiche';
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--ink-4)] bg-[var(--ink-0)] px-2 py-0.5 text-[12px] text-[var(--fg-3)]"
      title={`Le brouillon sera rédigé en ${CORRESPONDENT_LANG_LABEL[lang]} (${source}).`}
    >
      <label htmlFor={id} className="cursor-pointer">
        🌐 <span className="sr-only">Langue du brouillon, </span>
      </label>
      <select
        id={id}
        value={lang}
        onChange={(e) => onChange(e.target.value as CorrespondentLang)}
        // Transparent and borderless: the pill is the frame, the select is the
        // value inside it. `text-base sm:text-sm` for the same reason as the
        // fields around it — under 16px, iOS zooms the whole drawer on focus.
        className="cursor-pointer bg-transparent text-base text-[var(--fg-2)] focus:outline-none sm:text-[12px]"
      >
        {CORRESPONDENT_LANGS.map((l) => (
          <option key={l} value={l} className="bg-[var(--ink-2)] text-[var(--fg-1)]">
            {CORRESPONDENT_LANG_LABEL[l]}
          </option>
        ))}
      </select>
    </span>
  );
}
