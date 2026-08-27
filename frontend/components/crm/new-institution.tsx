'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { INSTITUTION_CATEGORIES } from '@/lib/crm/business';
import type { PersonRow } from '@/lib/crm/orphan-suggest';
import { loadIndex } from '@/lib/crm/people-index';

/**
 * Registering an institutional correspondent, from the filter that lists them.
 *
 * It sits under the Correspondances tab and nowhere else. An address is the
 * only thing that makes a thread findable — the VPS sync files mail against
 * known addresses and knows nothing about kinds — so this form is the whole
 * hinge of the feature: before it, the answer from an authority sits in the
 * orphan queue; after it, the entire exchange lands in its own file.
 *
 * `dossier` is here rather than deferred, and that was the correction. The
 * generator of institutional letters is grounded in that one line — it is the
 * only thing in its brief that cannot be derived from the thread — and this
 * form was the only way into the register, so the field the writing depends on
 * had no writing path at all. Role and website ride along optional: the API
 * preserves what a later write does not carry, so a half-filled fiche is a
 * fiche to complete rather than a fiche to redo.
 *
 * `category` is a set of shortcuts, not a dropdown that decides what exists.
 * The column is free TEXT and the labels come from one exported table, so a
 * value nobody foresaw is typed rather than refused, and it renders as itself.
 */
/**
 * The id `aria-controls` points at. A constant rather than a useId: this form
 * is rendered once, under one filter, so a per-instance id would buy nothing
 * and would make the attribute harder to read in the DOM.
 */
const FORM_ID = 'new-institution-fields';

export function NewInstitutionForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [category, setCategory] = useState(INSTITUTION_CATEGORIES[0].value);
  const [custom, setCustom] = useState('');
  const [country, setCountry] = useState('');
  const [role, setRole] = useState('');
  const [website, setWebsite] = useState('');
  const [dossier, setDossier] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [rows, setRows] = useState<PersonRow[] | null>(null);

  // Advisory only, and deliberately silent on failure: this warning saves the
  // operator a fiche that would never show up, but nothing here should stop a
  // correspondent being filed because an index fetch did not answer.
  useEffect(() => {
    if (!open || rows !== null) return;
    let alive = true;
    loadIndex().then(
      (r) => alive && setRows(r),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [open, rows]);

  const FREE = '__libre__';
  const chosen = category === FREE ? custom.trim() : category;
  const cleanedEmail = email.trim().toLowerCase();
  // The address is already somebody's. The register will happily store the
  // fiche — it is a different table — but the mail rows cede a claimed address
  // to the commercial file that holds it, so the row would never appear under
  // Correspondances and the operator would be looking for a fiche that exists.
  const claimed = rows?.some((r) => r.email === cleanedEmail) ?? false;
  // The same shape check the rest of the CRM makes on a typed address, and no
  // stricter: the API validates for real, and a regex that refuses a valid
  // institutional address would leave the operator with no way in at all.
  const valid = cleanedEmail.includes('@') && !!org.trim() && !!chosen;

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch('/api/crm/institutional-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `null` and never `''` for the optional fields: the upsert COALESCEs
        // them, so an empty string would be a value and would overwrite what a
        // previous write had recorded. Null is what "I am not saying anything
        // about this field" has to look like on the wire.
        body: JSON.stringify({
          email: cleanedEmail,
          org: org.trim(),
          category: chosen,
          country: country.trim() || null,
          role: role.trim() || null,
          website: website.trim() || null,
          dossier: dossier.trim() || null,
        }),
      });
      const data: unknown = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = (data as { message?: string; error?: string }).message ?? (data as { error?: string }).error;
        setMessage({ text: `Échec de l’enregistrement : ${detail ?? `HTTP ${r.status}`}`, bad: true });
        return;
      }
      setMessage({
        text: `✓ ${org.trim()} enregistré. Son fil remonte au prochain passage de la synchro.`,
        bad: false,
      });
      setEmail('');
      setOrg('');
      setCountry('');
      setCustom('');
      setRole('');
      setWebsite('');
      setDossier('');
      // The row appearing in the filter IS the confirmation, exactly as the
      // list's own gestures work. Nothing here re-derives the contact list.
      router.refresh();
    } catch {
      setMessage({ text: 'Erreur réseau, rien n’a été enregistré.', bad: true });
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full min-w-0 rounded border border-[var(--ink-4)] bg-[var(--ink-0)] px-2 py-1.5 text-base text-[var(--fg-1)] placeholder:text-[var(--fg-5)] focus:border-[var(--amber-500)]/50 focus:outline-none sm:text-[12.5px]';

  return (
    <div className="border-b border-[var(--ink-4)]/60 px-4 py-2.5">
      {/* One button, one name, in both states. It used to be two: "+ Nouveau
          correspondant" carrying aria-expanded={false}, replaced on open by a
          "fermer" button carrying aria-expanded and controlling nothing. A
          screen reader was told the thing it had just expanded had vanished and
          that some unrelated control was expanded instead. The glyph is the
          only part that changes, and it is aria-hidden precisely so the name
          does not. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={FORM_ID}
        className="text-[12.5px] text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)]"
      >
        <span aria-hidden="true">{open ? '− ' : '+ '}</span>
        Nouveau correspondant
      </button>
      {open && (
        <div id={FORM_ID} className="mt-1.5 flex flex-col gap-1.5">
          <input
            type="text"
            autoComplete="off"
            inputMode="email"
            aria-label="Adresse du correspondant"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="adresse du service…"
            className={field}
          />
          {claimed && (
            <p className="text-[11.5px] text-amber-300">
              ⚠ adresse déjà revendiquée par un dossier client/prospect — la fiche correspondant sera créée mais
              n&apos;apparaîtra pas sous Correspondances tant que l&apos;adresse reste revendiquée.
            </p>
          )}
          <input
            type="text"
            autoComplete="off"
            aria-label="Nom de l’institution"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="nom de l’institution…"
            className={field}
          />
          <select
            aria-label="Catégorie"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={field}
          >
            {INSTITUTION_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
            <option value={FREE}>autre catégorie (à écrire)…</option>
          </select>
          {category === FREE && (
            <input
              type="text"
              autoComplete="off"
              aria-label="Catégorie à écrire"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="catégorie…"
              className={field}
            />
          )}
          <input
            type="text"
            autoComplete="off"
            aria-label="Pays, code ISO à 2 lettres (facultatif)"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            // Two letters, and the API refuses the rest rather than slicing it:
            // "Suisse" used to be stored as "SU", then served on the file header
            // and cited in outgoing mail as a country code.
            maxLength={2}
            placeholder="pays ISO-2 (CH, DE…) — facultatif"
            className={field}
          />
          {/* The one field the letter generator cannot do without: it is the
              only line of its brief that is not derivable from the thread. A
              textarea rather than an input because it is a sentence, and it is
              read back weeks later by whoever forgot where the request stood. */}
          <textarea
            rows={2}
            aria-label="Dossier : ce qu’on leur demande"
            value={dossier}
            onChange={(e) => setDossier(e.target.value)}
            placeholder="dossier : ce qu’on leur demande…"
            className={`${field} resize-y`}
          />
          <span className="text-[11px] text-[var(--fg-4)]">
            Pourquoi on leur écrit, où en est la demande — le générateur de réponses s’appuie dessus.
          </span>
          <input
            type="text"
            autoComplete="off"
            aria-label="Rôle ou service (facultatif)"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="rôle / service (facultatif)…"
            className={field}
          />
          <input
            type="text"
            autoComplete="off"
            inputMode="url"
            aria-label="Site web (facultatif)"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="site web (facultatif)…"
            className={field}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!valid || busy}
              onClick={submit}
              className="rounded border border-emerald-500/50 px-2.5 py-1.5 text-[12px] font-medium text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
            >
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <span className="text-[11.5px] text-[var(--fg-4)]">
              L’adresse suffit : le fil se rattache tout seul ensuite.
            </span>
          </div>
          {/* Said out loud because the form gives no other sign of it: the same
              address entered twice is one fiche, not two, and a field left
              empty on the second pass keeps what the first one recorded. That
              is what makes completing a fiche later a safe gesture. */}
          <span className="text-[11px] text-[var(--fg-4)]">
            Ré-enregistrer une adresse déjà connue met à jour sa fiche ; les champs laissés vides gardent leur
            valeur actuelle.
          </span>
        </div>
      )}
      {/* Permanent, and that is the whole point: an aria-live region mounted at
          the same moment as its content announces nothing, because there was no
          region to observe a change in. */}
      <div aria-live="polite">
        {message && (
          <p className={`mt-1.5 text-[11.5px] ${message.bad ? 'text-red-300' : 'text-emerald-400'}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
