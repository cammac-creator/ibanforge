'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { INSTITUTION_CATEGORIES } from '@/lib/crm/business';

/**
 * Registering an institutional correspondent, from the filter that lists them.
 *
 * It sits under the Correspondances tab and nowhere else. An address is the
 * only thing that makes a thread findable — the VPS sync files mail against
 * known addresses and knows nothing about kinds — so this form is the whole
 * hinge of the feature: before it, the answer from an authority sits in the
 * orphan queue; after it, the entire exchange lands in its own file.
 *
 * Deliberately four fields. Everything else the correspondent could carry
 * (role, website, the file line) is worth having and is not worth a wall of
 * inputs at the moment the operator wants to file an address and move on; the
 * API takes the same shape whatever is filled, so the rest can be added later
 * through the very same upsert.
 *
 * `category` is a set of shortcuts, not a dropdown that decides what exists.
 * The column is free TEXT and the labels come from one exported table, so a
 * value nobody foresaw is typed rather than refused, and it renders as itself.
 */
export function NewInstitutionForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [category, setCategory] = useState(INSTITUTION_CATEGORIES[0].value);
  const [custom, setCustom] = useState('');
  const [country, setCountry] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const FREE = '__libre__';
  const chosen = category === FREE ? custom.trim() : category;
  const cleanedEmail = email.trim().toLowerCase();
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
        body: JSON.stringify({
          email: cleanedEmail,
          org: org.trim(),
          category: chosen,
          country: country.trim() || null,
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

  if (!open) {
    return (
      <div className="border-b border-[var(--ink-4)]/60 px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="text-[12.5px] text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)]"
        >
          + Nouveau correspondant
        </button>
        {message && !message.bad && (
          <p aria-live="polite" className="mt-1 text-[11.5px] text-emerald-400">
            {message.text}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--ink-4)]/60 px-4 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-4)]">
          Nouveau correspondant
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-expanded
          className="text-[12px] text-[var(--fg-4)] underline underline-offset-2 hover:text-[var(--fg-2)]"
        >
          fermer
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
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
          aria-label="Pays (facultatif)"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="pays (facultatif)…"
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
      </div>
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
