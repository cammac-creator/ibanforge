'use client';

import { useEffect, useRef, useState } from 'react';
import { INSTITUTION_CATEGORIES } from '@/lib/crm/business';
import {
  bestMatch,
  MATCH_REASON_FR,
  suggestFor,
  type BestMatch,
  type PersonRow,
} from '@/lib/crm/orphan-suggest';
import { invalidateAliases, loadAliases, loadIndex } from '@/lib/crm/people-index';

/**
 * The three gestures that let the orphan queue empty:
 *
 * - "this orphan IS that customer" — registers the sender as an alias of the
 *   canonical address (honoured by the write endpoints and the VPS sync's
 *   known-address net), then resolves the orphan. From the next sync run the
 *   sender's whole thread folds into the customer's file, forever.
 * - "this is an institution writing to us" — registers the SENDER itself as an
 *   institutional correspondent, then resolves the orphan against its own
 *   address. No alias: nothing is being merged into anything, an authority is
 *   its own file. This is the road that was missing, and it was the expensive
 *   one: the comment below used to name "an authority answering one of our
 *   permission letters" as an example of mail to DISMISS, so the one answer
 *   worth keeping forever was filed as noise, and the next mail from the same
 *   desk arrived just as unknown.
 * - "this is nobody's mail" — resolves the orphan with no alias, for the mail
 *   that is legitimately nobody's (a newsletter, an automatic notice). Without
 *   this exit the queue could only grow, and a queue that cannot reach zero
 *   stops being read.
 *
 * The canonical address is picked from the CRM's people index, not recalled
 * from memory: the operator is looking at an UNKNOWN address, so the one thing
 * they cannot be asked for is the known one. Free typing stays possible — the
 * index can lag reality — but an address the index does not know is flagged
 * before it is confirmed.
 */

// The index and alias caches live in lib/crm/people-index.ts: the correspondent
// form asks the same index the same question, and two copies would mean two
// fetches and two chances to drop the retry-on-failure behaviour.

type Mode = 'closed' | 'attach' | 'institution' | 'dismiss';
type Busy = 'idle' | 'busy' | 'error';

/** Free-category sentinel: the select offers it, the input under it carries it. */
const FREE_CATEGORY = '__libre__';

/**
 * `automated`: the panel recognised a DMARC report or a no-reply sender. The
 * dismissal then comes first, and no client is proposed: nobody is behind it.
 */
export function AttachOrphanControl({
  orphanId,
  sender,
  subject = null,
  automated = false,
}: {
  orphanId: string;
  sender: string;
  /** Named in the dismissal question, so the row being filed is the row being read. */
  subject?: string | null;
  automated?: boolean;
}) {
  const [mode, setMode] = useState<Mode>('closed');
  // What the last undo did, said once in the closed state. Distinct from
  // `message`, which only ever carries a failure.
  const [notice, setNotice] = useState('');
  const [dossier, setDossier] = useState('');
  const [canonical, setCanonical] = useState('');
  const [armed, setArmed] = useState(false);
  // A plain double-click must not count as arm + confirm: the two clicks land
  // on the same button, and the state update from the first is committed
  // before the second event runs. The pause is what makes the second click a
  // decision instead of a reflex — the native confirm this replaced imposed
  // one by construction.
  const armedAtRef = useRef(0);
  const [busy, setBusy] = useState<Busy>('idle');
  const [message, setMessage] = useState('');
  const [rows, setRows] = useState<PersonRow[] | 'failed' | null>(null);
  const [knownAlias, setKnownAlias] = useState<string | null>(null);
  const [org, setOrg] = useState('');
  const [category, setCategory] = useState(INSTITUTION_CATEGORIES[0].value);
  const [customCategory, setCustomCategory] = useState('');
  const [country, setCountry] = useState('');
  const [done, setDone] = useState<
    | { kind: 'attached'; to: string }
    | { kind: 'registered'; org: string }
    | { kind: 'dismissed' }
    | null
  >(null);

  // Both roads need the index, and for opposite reasons. "Attach" reads it to
  // SUGGEST a canonical address and to flag one it does not know. "Institution"
  // reads it to WARN: an address the CRM already holds as a client or a prospect
  // is one the correspondent register cannot really claim, and filing it twice
  // is how the same desk ends up with two identities. Loading it for the first
  // mode only meant the more expensive of the two mistakes was the unguarded one.
  // Loaded on mount as well (03/09/2026): the closed state names the most
  // likely client BEFORE the operator opens anything, and that needs the index.
  // One fetch per browser session either way (lib/crm/people-index.ts caches).
  // On an automated notice the closed state proposes nobody, so it needs no
  // index; but the moment a form OPENS on such a row, every guard below reads
  // `rows` and `knownAlias` — the suggestions, the unknown-address warning,
  // the double-identity warning. Gating on `automated` alone left all six
  // silent on exactly the class of mail (build and release notices) that had
  // just been recognised as automated, the morning after they caused a wrong
  // alias. Hence `mode` in the condition and in the dependencies.
  useEffect(() => {
    if ((automated && mode === 'closed') || rows !== null) return;
    let alive = true;
    loadIndex().then(
      (r) => alive && setRows(r),
      () => alive && setRows('failed'),
    );
    loadAliases().then(
      (m) => alive && setKnownAlias(m.get(sender) ?? null),
      () => alive && setKnownAlias(null),
    );
    return () => {
      alive = false;
    };
  }, [automated, mode, rows, sender]);

  const proposal: BestMatch | null =
    !automated && Array.isArray(rows) ? bestMatch(sender, rows) : null;

  /**
   * The way back, offered in the breath after each gesture.
   *
   * Right after « Rattacher » the undo is free: the alias was just written and
   * the sync has not run, so removing it moves nothing. Fifteen minutes later
   * the same removal hands months of mail back to the sender's own thread —
   * still correct, but no longer free — which is why the link sits here, on
   * the confirmation, and not only in the alias drawer of the Contacts page.
   * Either way the orphan itself returns to the queue, so nothing is decided
   * by the undo except that nothing is decided.
   */
  async function undo(kind: 'attached' | 'dismissed'): Promise<void> {
    setBusy('busy');
    try {
      if (kind === 'attached') {
        await del('/api/crm/email-aliases', { alias: sender });
        invalidateAliases();
      }
      await del('/api/crm/orphan-resolve', { id: orphanId });
      setDone(null);
      setMode('closed');
      setArmed(false);
      setBusy('idle');
      setMessage('');
      setNotice(
        kind === 'attached'
          ? 'Rattachement annulé : l’alias est retiré, le mail attend de nouveau ici.'
          : 'Remis en file : le mail attend de nouveau ici.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'échec');
      setBusy('error');
    }
  }

  const undoFailure = busy === 'error' && (
    <span className="ml-2 text-red-300">échec de l’annulation : {message}</span>
  );

  if (done?.kind === 'attached') {
    return (
      <p aria-live="polite" className="mt-1 text-[12px] text-emerald-400">
        ✓ {sender} rattaché à {done.to} — alias permanent enregistré ; son fil complet remonte au
        prochain passage de la synchro (au plus 15 min).{' '}
        <button
          type="button"
          disabled={busy === 'busy'}
          onClick={() => void undo('attached')}
          className="cursor-pointer underline underline-offset-2 hover:text-emerald-200 disabled:opacity-50"
        >
          {busy === 'busy' ? 'annulation…' : 'annuler ce rattachement'}
        </button>
        {undoFailure}
      </p>
    );
  }
  if (done?.kind === 'registered') {
    // Its own sentence, and not the 'attached' one. That one says "rattaché à
    // {to}", which would print the sender's own address as the thing it was
    // attached to — true and unreadable. Nothing was merged here: an address
    // was given a name and a file of its own.
    // "Retrouve-le sous Correspondances" was true and premature: the register
    // now holds the address, but the thread is filed against it by the VPS sync,
    // so nothing is under that tab until the next run. An operator who clicks
    // through immediately, finds an empty file and concludes the register did
    // not work is exactly the road back to the orphan queue.
    return (
      <p aria-live="polite" className="mt-1 text-[12px] text-sky-300">
        ✓ {sender} enregistré comme correspondant ({done.org}) — son fil, cette réponse comprise,
        remonte au prochain passage de la synchro (au plus 15 min), sous « Correspondances ».
      </p>
    );
  }
  if (done?.kind === 'dismissed') {
    return (
      <p aria-live="polite" className="mt-1 text-[12px] text-[var(--fg-3)]">
        ✓ Classé sans rattachement.{' '}
        <button
          type="button"
          disabled={busy === 'busy'}
          onClick={() => void undo('dismissed')}
          className="cursor-pointer underline underline-offset-2 hover:text-[var(--fg-1)] disabled:opacity-50"
        >
          {busy === 'busy' ? 'un instant…' : 'remettre en file'}
        </button>
        {undoFailure}
      </p>
    );
  }

  if (mode === 'closed') {
    const openAttach = (prefill?: string) => {
      if (prefill) setCanonical(prefill);
      setMode('attach');
      // A previous index failure must not freeze this control in the
      // degraded state forever: reopening retries the fetch.
      if (rows === 'failed') setRows(null);
    };
    const dismissButton = (
      <button
        type="button"
        onClick={() => setMode('dismiss')}
        className={
          automated
            ? 'rounded border border-sky-500/50 px-2 py-1 text-[12px] font-medium text-sky-300 hover:bg-sky-500/10'
            : 'rounded border border-[var(--ink-4)] px-2 py-1 text-[12px] text-[var(--fg-3)] hover:text-[var(--fg-1)]'
        }
      >
        Classer sans rattacher
      </button>
    );
    return (
      <div className="mt-1.5">
        {notice && (
          <p role="status" className="mb-1.5 text-[12px] text-[var(--fg-2)]">
            {notice}
          </p>
        )}
        {/* The pre-selection, before any typing: the row the index ranks
            first for this sender, with the reason in plain words. It is a
            proposal, never a decision: the button only opens the attach form
            with the address filled in, and the two-click confirmation stays. */}
        {proposal && (
          <p className="mb-1.5 text-[12px] text-[var(--fg-2)]">
            <span className="text-[var(--fg-3)]">Probablement</span>{' '}
            <strong>{proposal.row.label || proposal.row.email}</strong>{' '}
            <span className="text-[var(--fg-4)]">
              ({proposal.row.email}, {proposal.row.kind === 'client' ? 'client' : 'prospect'} ·{' '}
              {MATCH_REASON_FR[proposal.reason]})
            </span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {automated && dismissButton}
          {proposal ? (
            <button
              type="button"
              onClick={() => openAttach(proposal.row.email)}
              className="rounded border border-emerald-500/50 px-2 py-1 text-[12px] font-medium text-emerald-400 hover:bg-emerald-500/10"
            >
              Rattacher à {proposal.row.label || proposal.row.email}…
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => openAttach()}
            className="rounded border border-amber-500/40 px-2 py-1 text-[12px] font-medium text-amber-400 hover:bg-amber-500/10"
          >
            {proposal ? 'Un autre client…' : 'Rattacher à un client…'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('institution');
              // Same retry as the alias road, and now that this mode reads the
              // index it needs it for the same reason: a failure left in place
              // would freeze the double-identity warnings off for good.
              if (rows === 'failed') setRows(null);
            }}
            className="rounded border border-sky-500/40 px-2 py-1 text-[12px] font-medium text-sky-300 hover:bg-sky-500/10"
          >
            {/* Not "rattacher": nothing is attached to anything here. The sender
              IS the file being opened, and a verb that says otherwise is what
              sent this gesture looking for a customer to merge into. */}
            Enregistrer comme correspondant…
          </button>
          {!automated && dismissButton}
        </div>
      </div>
    );
  }

  const reset = () => {
    setMode('closed');
    setArmed(false);
    setBusy('idle');
    setMessage('');
  };

  const clearFailure = () => {
    if (busy === 'error') {
      setBusy('idle');
      setMessage('');
    }
  };

  async function post(path: string, body: unknown): Promise<unknown> {
    return call('POST', path, body);
  }

  async function del(path: string, body: unknown): Promise<unknown> {
    return call('DELETE', path, body);
  }

  async function call(method: 'POST' | 'DELETE', path: string, body: unknown): Promise<unknown> {
    const r = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data: unknown = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data as { message?: string }).message;
      throw new Error(msg ?? `HTTP ${r.status}`);
    }
    return data;
  }

  if (mode === 'institution') {
    const chosenCategory = category === FREE_CATEGORY ? customCategory.trim() : category;
    const cleanedOrg = org.trim();
    const ready = !!cleanedOrg && !!chosenCategory;
    // The word the operator picked, not the value the column stores. Looked up
    // rather than run through the row chip's helper, which caps its label with
    // an ellipsis: right for a 296px column, wrong for a sentence being read
    // before a confirmation.
    const categoryLabel =
      category === FREE_CATEGORY
        ? customCategory.trim()
        : (INSTITUTION_CATEGORIES.find((c) => c.value === category)?.label ?? category);
    // The sender as the index stores addresses. Both warnings below are
    // advisory: they never disable the button, because the index can lag and an
    // authority that also holds a key is a real, if rare, thing to file.
    const senderKey = sender.trim().toLowerCase();
    const known = Array.isArray(rows) ? rows.find((r) => r.email === senderKey) : undefined;
    const field =
      'min-w-0 flex-1 rounded border border-[var(--ink-4)] bg-[var(--ink-0)] px-2 py-1.5 text-base text-[var(--fg-1)] placeholder:text-[var(--fg-5)] focus:border-sky-500/50 focus:outline-none sm:max-w-[220px] sm:text-[12.5px]';

    return (
      <div className="mt-1.5">
        <p className="mb-1.5 text-[12px] text-[var(--fg-3)]">
          Enregistrer <strong>{sender}</strong> comme correspondant institutionnel — autorité,
          banque centrale, réseau, registre, fournisseur. Son fil aura son propre dossier.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            autoComplete="off"
            aria-label="Nom de l’institution"
            value={org}
            onChange={(e) => {
              setOrg(e.target.value);
              setArmed(false);
              clearFailure();
            }}
            placeholder="nom de l’institution…"
            className={field}
          />
          <select
            aria-label="Catégorie"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setArmed(false);
              clearFailure();
            }}
            className={field}
          >
            {INSTITUTION_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
            <option value={FREE_CATEGORY}>autre catégorie (à écrire)…</option>
          </select>
          {category === FREE_CATEGORY && (
            <input
              type="text"
              autoComplete="off"
              aria-label="Catégorie à écrire"
              value={customCategory}
              onChange={(e) => {
                setCustomCategory(e.target.value);
                setArmed(false);
                clearFailure();
              }}
              placeholder="catégorie…"
              className={field}
            />
          )}
          <input
            type="text"
            autoComplete="off"
            aria-label="Pays, code ISO à 2 lettres (facultatif)"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              // Disarming here too. Every other field does it, and the one that
              // did not was the field most likely to be corrected last: the
              // armed sentence would have been confirming a country nobody had
              // read back.
              setArmed(false);
              clearFailure();
            }}
            // The API refuses anything that is not two letters rather than
            // slicing it, so the field says the shape it wants and cannot hold
            // more than it: "Suisse" typed here used to be stored as "SU".
            maxLength={2}
            placeholder="pays ISO-2 (CH, DE…) — facultatif"
            className={field}
          />
          {/* The one field the letter generator cannot do without, and the
              full form under « Correspondances » has it: a correspondent born
              here — the usual road, since an authority makes itself known by
              answering — used to be filed without it, and nothing said so. */}
          <textarea
            aria-label="Dossier : ce qu’on leur demande (facultatif)"
            value={dossier}
            onChange={(e) => {
              setDossier(e.target.value);
              setArmed(false);
              clearFailure();
            }}
            rows={2}
            placeholder="dossier : ce qu’on leur demande, où on en est… (facultatif, le générateur de lettres s’appuie dessus)"
            className="w-full min-w-0 resize-y rounded border border-[var(--ink-4)] bg-[var(--ink-0)] px-2 py-1.5 text-base text-[var(--fg-1)] placeholder:text-[var(--fg-5)] focus:border-sky-500/50 focus:outline-none sm:text-[12.5px]"
          />
          <button
            type="button"
            disabled={busy === 'busy' || !ready}
            onClick={async () => {
              // Same two-click arming as the alias road, for the same reason:
              // the second click has to be a decision, and a plain double-click
              // must not count as both.
              if (!armed) {
                setArmed(true);
                armedAtRef.current = Date.now();
                return;
              }
              if (Date.now() - armedAtRef.current < 400) return;
              setBusy('busy');
              try {
                // The register FIRST, the queue second. If the second call
                // fails the correspondent is already known — the address is
                // what makes the whole thread come back — and the orphan is
                // still in a queue the operator can act on again. The other
                // order would resolve the orphan and lose the address on a
                // failure, which is unrecoverable from this screen.
                await post('/api/crm/institutional-contacts', {
                  email: sender,
                  org: cleanedOrg,
                  category: chosenCategory,
                  country: country.trim() || null,
                  dossier: dossier.trim() || null,
                });
                // attached_to is the sender itself: it IS the canonical
                // address of this file, so `resolved_as` records the truth
                // rather than a merge that never happened.
                await post('/api/crm/orphan-resolve', { id: orphanId, attached_to: sender });
                setDone({ kind: 'registered', org: cleanedOrg });
              } catch (e) {
                setMessage(e instanceof Error ? e.message : 'échec');
                setBusy('error');
                setArmed(false);
              }
            }}
            className={`rounded border px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40 ${
              armed
                ? 'border-sky-400 bg-sky-500/15 text-sky-200'
                : 'border-sky-500/50 text-sky-300 hover:bg-sky-500/10'
            }`}
          >
            {busy === 'busy' ? 'Enregistrement…' : armed ? 'Oui, enregistrer' : 'Enregistrer'}
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded px-1.5 py-1 text-[12px] text-[var(--fg-4)] hover:text-[var(--fg-2)]"
          >
            annuler
          </button>
        </div>
        <div aria-live="polite">
          {/* An address the CRM already holds under a commercial identity. The
              register would accept it, and the row would then never appear
              under "Correspondances": the mail rows cede a claimed address to
              the client or prospect file. Said before the confirmation, not
              after, because after it there is nothing left to decide. */}
          {knownAlias ? (
            <p className="mt-1 text-[11.5px] text-amber-300">
              ⚠ {sender} est déjà rattaché au client {knownAlias} — l&apos;enregistrer comme
              correspondant créerait une double identité.
            </p>
          ) : (
            known && (
              <p className="mt-1 text-[11.5px] text-amber-300">
                ⚠ {sender} est déjà connu du CRM comme{' '}
                {known.kind === 'client' ? 'client' : 'prospect'}.
              </p>
            )
          )}
          {armed && (
            <p className="mt-1.5 text-[12px] text-sky-200">
              Enregistrer <strong>{sender}</strong> sous <strong>{cleanedOrg}</strong> (
              {categoryLabel}). Reclique pour confirmer.
            </p>
          )}
          {busy === 'error' && <p className="mt-1 text-[12px] text-red-300">échec : {message}</p>}
        </div>
      </div>
    );
  }

  if (mode === 'dismiss') {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[var(--fg-3)]">
          {/* "autorité" used to be the example given here, which sent the one
              answer worth keeping down the dismissal road. It now has its own
              button, so the examples name what is genuinely nobody's mail. */}
          Classer{' '}
          {subject ? (
            <>
              « <strong>{subject}</strong> »
            </>
          ) : (
            'ce mail'
          )}{' '}
          de <strong>{sender}</strong> sans le relier à personne (newsletter, avis automatique…) ?
          Réversible depuis « classés récemment ».
        </span>
        <button
          type="button"
          disabled={busy === 'busy'}
          onClick={async () => {
            setBusy('busy');
            try {
              await post('/api/crm/orphan-resolve', { id: orphanId });
              setDone({ kind: 'dismissed' });
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'échec');
              setBusy('error');
            }
          }}
          className="rounded border border-[var(--ink-4)] px-2.5 py-1 text-[12px] font-medium text-[var(--fg-2)] hover:bg-[var(--ink-4)]/40 disabled:opacity-40"
        >
          {busy === 'busy' ? 'Classement…' : 'Oui, classer'}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded px-1.5 py-1 text-[12px] text-[var(--fg-4)] hover:text-[var(--fg-2)]"
        >
          annuler
        </button>
        {busy === 'error' && (
          <span aria-live="polite" className="w-full text-[12px] text-red-300">
            échec : {message}
          </span>
        )}
      </div>
    );
  }

  // mode === 'attach'
  const cleaned = canonical.trim().toLowerCase();
  const valid = cleaned.includes('@') && cleaned !== sender;
  const suggestions = Array.isArray(rows)
    ? suggestFor(sender, canonical, rows).filter((r) => r.email !== sender)
    : [];
  const addressKnown =
    !Array.isArray(rows) || rows.length === 0 || rows.some((r) => r.email === cleaned);

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          autoComplete="off"
          aria-label="Client à rattacher : nom, société ou adresse"
          value={canonical}
          onChange={(e) => {
            setCanonical(e.target.value);
            setArmed(false);
            clearFailure();
          }}
          placeholder="nom, société ou adresse…"
          className="min-w-0 flex-1 rounded border border-[var(--ink-4)] bg-[var(--ink-0)] px-2 py-1.5 text-base text-[var(--fg-1)] placeholder:text-[var(--fg-5)] focus:border-amber-500/50 focus:outline-none sm:max-w-[280px] sm:text-[12.5px]"
        />
        <button
          type="button"
          disabled={busy === 'busy' || !valid}
          onClick={async () => {
            if (!armed) {
              setArmed(true);
              armedAtRef.current = Date.now();
              return;
            }
            if (Date.now() - armedAtRef.current < 400) return;
            setBusy('busy');
            try {
              const aliasReply = (await post('/api/crm/email-aliases', {
                alias: sender,
                canonical: cleaned,
              })) as {
                aliases?: Array<{ alias: string; canonical: string }>;
              };
              // The server resolves alias chains; its answer, not the typed
              // address, is what resolved_as must record — a later reader of
              // resolved_as trusts it over re-deciding.
              const resolved =
                aliasReply.aliases?.find((a) => a.alias === sender)?.canonical ?? cleaned;
              // The session cache of the alias map must forget what it knew:
              // a second orphan from this sender has to see the alias just
              // written, or the double-identity warning stays silent.
              invalidateAliases();
              await post('/api/crm/orphan-resolve', { id: orphanId, attached_to: resolved });
              setDone({ kind: 'attached', to: resolved });
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'échec');
              setBusy('error');
              setArmed(false);
            }
          }}
          className={`rounded border px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40 ${
            armed
              ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300'
              : 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10'
          }`}
        >
          {busy === 'busy' ? 'Rattachement…' : armed ? 'Oui, ils ne font qu’un' : 'Rattacher'}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded px-1.5 py-1 text-[12px] text-[var(--fg-4)] hover:text-[var(--fg-2)]"
        >
          annuler
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s.email}
              type="button"
              onClick={() => {
                setCanonical(s.email);
                setArmed(false);
                clearFailure();
              }}
              className={`rounded border px-2 py-1 text-[11.5px] ${
                cleaned === s.email
                  ? 'border-amber-400 bg-amber-500/15 text-amber-300'
                  : 'border-[var(--ink-4)] text-[var(--fg-2)] hover:border-amber-500/40 hover:text-amber-300'
              }`}
            >
              {s.email}
              <span className="ml-1.5 text-[var(--fg-4)]">
                {s.label} · {s.kind === 'client' ? 'client' : 'prospect'}
              </span>
            </button>
          ))}
        </div>
      )}
      {Array.isArray(rows) && rows.length > 0 && suggestions.length === 0 && (
        <p className="mt-1 text-[11.5px] text-[var(--fg-4)]">
          Aucune correspondance dans le CRM — tape un nom, une société ou une adresse.
        </p>
      )}
      {rows === 'failed' && (
        <p className="mt-1 text-[11.5px] text-amber-300">
          L&apos;index CRM n&apos;a pas répondu : pas de suggestions ni de garde-fou d&apos;adresse
          inconnue. Saisie libre possible ; rouvre le formulaire pour réessayer.
        </p>
      )}

      <div aria-live="polite">
        {armed && (
          // Said in full because the gesture is not the one it looks like. It
          // reads as filing one mail; it writes a rule that outlives the mail,
          // and the next sync applies it to the address's whole past. The two
          // wrong aliases of 2026-09-03 were accepted under a sentence that
          // said "fusionnera" — future tense, one thread — and nothing more.
          <p className="mt-1.5 text-[12.5px] leading-snug text-emerald-300">
            Créer un alias <strong>permanent</strong> : <strong>{sender}</strong> →{' '}
            <strong>{cleaned}</strong>. Tout le courrier de cette adresse, passé compris, sera
            reversé dans ce dossier à chaque synchro. Réversible depuis « Alias enregistrés », en
            bas de la page Contacts.
            {knownAlias && knownAlias !== cleaned && (
              <strong className="text-amber-300">
                {' '}
                ⚠ {sender} est déjà rattaché à {knownAlias} ; confirmer le re-rattache.
              </strong>
            )}{' '}
            Reclique pour confirmer.
          </p>
        )}
        {valid && Array.isArray(rows) && rows.length > 0 && !addressKnown && (
          <p className="mt-1 text-[11.5px] text-amber-300">
            ⚠ {cleaned} n&apos;est ni un détenteur de clé ni un prospect connu du CRM — vérifie
            avant de confirmer.
          </p>
        )}
        {busy === 'error' && <p className="mt-1 text-[12px] text-red-300">échec : {message}</p>}
      </div>
    </div>
  );
}
