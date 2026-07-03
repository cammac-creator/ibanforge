'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UsageChart } from './usage-chart';

export interface CrmMessage {
  id?: string;
  direction: 'in' | 'out' | 'draft';
  msg_date: string | null;
  subject: string | null;
  snippet: string | null;
  snippet_fr?: string | null;
  lang?: string | null;
  body?: string | null;
  counterparty: string | null;
}

export interface CrmClient {
  email: string;
  key_prefix: string;
  company: string | null;
  sector: string | null;
  website: string | null;
  country: string | null;
  category: 'PAYANT' | 'PILOTE' | 'GRATUIT' | 'INTERNE';
  revenueUsd: number | null;
  health: number;
  action: string;
  consumed: number;
  limit: number;
  consumedPct: number | null;
  creditsTotal: number | null;
  status: 'replied' | 'awaiting' | 'followup_due' | 'not_contacted';
  lastTouch: string | null;
  account: string;
  subject: string;
  brief: string;
  messages: CrmMessage[];
  /** CRM-native draft awaiting review (one per client) — shown in the thread with send/edit/delete. */
  draft: CrmMessage | null;
  series: number[];
  months: string[];
  days: Array<{ day: string; count: number }>;
  lastActive: string | null;
  endpoints: Array<{ path: string; count: number }>;
  unread: boolean;
}

const CAT = {
  PAYANT: { label: 'Payant', dot: '#22c55e' },
  PILOTE: { label: 'Pilote', dot: '#3b82f6' },
  GRATUIT: { label: 'Gratuit', dot: '#a1a1aa' },
  INTERNE: { label: 'Interne', dot: '#52525b' },
} as const;

const STATUS = {
  replied: { label: 'A répondu', color: '#22c55e', bg: '#052e16' },
  awaiting: { label: 'En attente', color: '#3b82f6', bg: '#172554' },
  followup_due: { label: 'Relance due', color: '#f59e0b', bg: '#451a03' },
  not_contacted: { label: 'À contacter', color: '#a1a1aa', bg: '#27272a' },
} as const;

const TOOL: Record<string, string> = {
  '/v1/iban/validate': 'Validation IBAN',
  '/v1/iban/batch': 'Batch IBAN',
  '/v1/bic/:code': 'Lookup BIC',
  '/v1/ch/clearing/:iid': 'Clearing CH',
  '/v1/iban/compliance': 'Compliance',
  '/v1/iban/format': 'Format IBAN',
};

const LANG_LABEL: Record<string, string> = {
  fr: 'français', en: 'anglais', de: 'allemand', it: 'italien', es: 'espagnol', pt: 'portugais',
  nl: 'néerlandais', zh: 'chinois', ru: 'russe', ar: 'arabe', ja: 'japonais', pl: 'polonais',
  sv: 'suédois', da: 'danois', no: 'norvégien', fi: 'finnois', tr: 'turc', el: 'grec', he: 'hébreu',
  cs: 'tchèque', uk: 'ukrainien', ro: 'roumain', hu: 'hongrois',
};

function healthColor(h: number) {
  return h >= 80 ? '#22c55e' : h >= 40 ? '#f59e0b' : '#ef4444';
}

interface GenResult {
  subject: string;
  email_en: string;
  translation_fr: string;
  account: string;
}

export function CrmWorkspace({ clients }: { clients: CrmClient[] }) {
  const [filter, setFilter] = useState<'all' | 'payants' | 'relance'>('all');
  const [q, setQ] = useState('');
  const [readLocal, setReadLocal] = useState<Set<string>>(new Set());
  const [selEmail, setSelEmail] = useState<string | null>(null);

  const isUnread = (c: CrmClient) => c.unread && !readLocal.has(c.email);

  function open(email: string) {
    setSelEmail(email);
    const c = clients.find((x) => x.email === email);
    if (c && isUnread(c)) {
      setReadLocal((prev) => new Set(prev).add(email));
      fetch('/api/crm/thread-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }).catch(() => {});
    }
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return clients
      .filter((c) => {
        if (filter === 'payants' && c.category !== 'PAYANT') return false;
        if (filter === 'relance' && c.status !== 'followup_due') return false;
        if (term && !(`${c.company ?? ''} ${c.email}`.toLowerCase().includes(term))) return false;
        return true;
      })
      // Unread replies first, like an inbox (stable: keeps the priority order within each group).
      .sort((a, b) => Number(isUnread(b)) - Number(isUnread(a)));
  }, [clients, filter, q, readLocal]);

  const sel = clients.find((c) => c.email === selEmail) ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
      {/* LEFT — client list */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40">
        <div className="border-b border-zinc-800/60 p-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un client…"
            className="mb-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/40 focus:outline-none"
          />
          <div className="flex gap-1">
            {([['all', 'Tous'], ['payants', 'Payants'], ['relance', 'À relancer']] as const).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${filter === k ? 'bg-amber-500/15 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {filtered.length === 0 && <p className="p-4 text-sm text-zinc-600">Aucun client.</p>}
          {filtered.map((c) => {
            const st = STATUS[c.status];
            const active = c.email === selEmail;
            const unread = isUnread(c);
            return (
              <button
                key={c.email}
                type="button"
                onClick={() => open(c.email)}
                className={`flex w-full flex-col gap-1 border-b border-zinc-800/40 px-3 py-2.5 text-left transition-colors ${active ? 'bg-zinc-800/60' : unread ? 'bg-blue-500/10 hover:bg-blue-500/15' : 'hover:bg-zinc-800/30'}`}
              >
                <div className="flex items-center gap-2">
                  {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" title="Réponse non lue" />}
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: CAT[c.category].dot }} />
                  <span className={`truncate text-sm ${unread ? 'font-bold text-white' : 'font-medium text-zinc-200'}`}>{c.company ?? c.email}</span>
                  {c.revenueUsd ? <span className="ml-auto shrink-0 font-mono text-xs text-green-400">${c.revenueUsd}</span> : null}
                </div>
                <div className="flex items-center gap-2 pl-4">
                  <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style={{ color: st.color, backgroundColor: st.bg }}>
                    {st.label}
                  </span>
                  {c.lastTouch && <span className="text-[10px] text-zinc-600">{c.lastTouch}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT — detail */}
      <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
        {!sel ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-600">Sélectionne un client à gauche.</div>
        ) : (
          <ClientDetail client={sel} />
        )}
      </div>
    </div>
  );
}

export function ClientDetail({ client: c }: { client: CrmClient }) {
  return (
    <div className="flex flex-col gap-5">
      {/* identity */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800/60 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CAT[c.category].dot }} />
            <h2 className="text-lg font-semibold text-white">{c.company ?? c.email}</h2>
            {c.website && (
              <a href={c.website} target="_blank" rel="noreferrer" className="text-xs text-amber-400 hover:underline">
                site ↗
              </a>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            {c.email}
            {c.sector ? ` · ${c.sector}` : ''}
            {c.country ? ` · ${c.country}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-4 text-right">
          {c.revenueUsd != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-600">Revenu</p>
              <p className="font-mono text-sm font-semibold text-green-400">${c.revenueUsd}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-600">Santé</p>
            <p className="font-mono text-sm font-semibold" style={{ color: healthColor(c.health) }}>{c.health}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-600">{c.creditsTotal != null ? 'Crédits' : 'Quota'}</p>
            <p className="font-mono text-sm text-zinc-300">
              {c.creditsTotal != null ? `${c.consumed}/${c.creditsTotal}` : `${c.consumed}/${c.limit}`}
            </p>
          </div>
        </div>
        <UsageChart days={c.days} series={c.series} months={c.months} />
      </div>

      {/* next action */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
        <span className="text-[10px] uppercase tracking-wide text-amber-500/70">Prochaine action</span>
        <p>{c.action}</p>
      </div>

      <Timeline client={c} />
      <Composer client={c} />
    </div>
  );
}

export function TimelineMessage({ m }: { m: CrmMessage }) {
  const [open, setOpen] = useState(false);
  const [showOrig, setShowOrig] = useState(false);
  // Show a French translation by default for ANY non-French message (English included).
  // Guard against malformed lang values (e.g. model echoing a placeholder, or 'und').
  const validLang = !!(m.lang && /^[a-z]{2,3}$/.test(m.lang) && m.lang !== 'und');
  const hasFr = !!(validLang && m.lang !== 'fr' && m.snippet_fr);
  const original = m.body || m.snippet || '';
  const frText = hasFr ? m.snippet_fr || '' : '';
  const display = hasFr && !showOrig ? frText : original;
  const long = display.length > 300;
  const text = open || !long ? display : display.slice(0, 300) + '…';
  return (
    <div className="relative">
      <span
        className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-zinc-900"
        style={{ backgroundColor: m.direction === 'in' ? '#3b82f6' : '#f59e0b' }}
      />
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <span className={m.direction === 'in' ? 'text-blue-400' : 'text-amber-400'}>
          {m.direction === 'in' ? '📥 reçu' : '📨 envoyé'}
        </span>
        <span>{m.msg_date}</span>
        {validLang && (
          <span
            className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] text-violet-300"
            title={hasFr ? 'Traduit automatiquement en français' : 'Langue détectée du message'}
          >
            🌐 {(m.lang && LANG_LABEL[m.lang]) || m.lang}
            {hasFr && !showOrig ? ' · traduit' : ''}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs font-medium text-zinc-200">{m.subject || '(sans objet)'}</p>
      {display && (
        <p className={`mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed ${hasFr && !showOrig ? 'text-violet-200/80' : 'text-zinc-400'}`}>
          {text}
        </p>
      )}
      <div className="mt-1 flex gap-3 text-[10px]">
        {long && (
          <button type="button" onClick={() => setOpen(!open)} className="text-zinc-500 hover:text-zinc-300">
            {open ? 'réduire' : 'voir tout'}
          </button>
        )}
        {hasFr && (
          <button type="button" onClick={() => setShowOrig(!showOrig)} className="text-violet-400 hover:text-violet-300">
            {showOrig ? 'voir la traduction' : 'voir l’original'}
          </button>
        )}
      </div>
    </div>
  );
}

function Timeline({ client: c }: { client: CrmClient }) {
  const tool = c.endpoints[0] ? `${TOOL[c.endpoints[0].path] ?? c.endpoints[0].path}` : null;
  const totalCalls = c.series.reduce((a, b) => a + b, 0);
  return (
    <div>
      <p className="mb-3 text-[11px] uppercase tracking-wide text-zinc-500">Timeline</p>
      <div className="relative flex flex-col gap-3 border-l border-zinc-800 pl-4">
        {c.messages.length === 0 && <p className="text-sm text-zinc-600">Aucun échange mail pour l’instant.</p>}
        {c.messages.map((m, i) => (
          <TimelineMessage key={i} m={m} />
        ))}
        {c.draft && <DraftCard client={c} draft={c.draft} />}
        {totalCalls > 0 && (
          <div className="relative">
            <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-zinc-900 bg-violet-500" />
            <p className="text-[11px] text-zinc-500">
              ⚡ {totalCalls} appels sur 6 mois{tool ? ` · surtout ${tool}` : ''}
              {c.lastActive ? ` · dernier mois actif ${c.lastActive}` : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A CRM-native draft sitting in the thread: review it, adjust it in place,
 * then send it (the draft row is replaced by the instant 'out' record) or
 * discard it. One draft per client — saving overwrites.
 */
function DraftCard({ client: c, draft }: { client: CrmClient; draft: CrmMessage }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject ?? '');
  const [body, setBody] = useState(draft.body ?? draft.snippet ?? '');
  const [busy, setBusy] = useState<false | 'send' | 'save' | 'del'>(false);
  const [msg, setMsg] = useState<string | null>(null);
  const account = draft.counterparty || c.account;

  async function send() {
    setBusy('send');
    setMsg(null);
    try {
      const r = await fetch('/api/crm/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, to: c.email, subject, body }),
      });
      const d = await r.json();
      if (!r.ok) setMsg(d.message || d.error || 'Échec envoi');
      else {
        if (draft.id) {
          await fetch('/api/crm/draft-message', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: draft.id }),
          }).catch(() => {});
        }
        setMsg('✅ Envoyé — le brouillon devient un message de la timeline.');
        router.refresh();
      }
    } catch {
      setMsg('Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy('save');
    setMsg(null);
    try {
      const r = await fetch('/api/crm/draft-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: c.email, subject, body, account }),
      });
      if (!r.ok) setMsg('Échec de l’enregistrement');
      else {
        setMsg('💾 Brouillon enregistré.');
        setEditing(false);
        router.refresh();
      }
    } catch {
      setMsg('Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!draft.id) return;
    setBusy('del');
    setMsg(null);
    try {
      const r = await fetch('/api/crm/draft-message', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id }),
      });
      if (!r.ok) setMsg('Échec de la suppression');
      else router.refresh();
    } catch {
      setMsg('Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-zinc-900 bg-zinc-500" />
      <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-semibold text-amber-400">📝 brouillon — en attente de ta relecture</span>
          <span className="text-zinc-500">{draft.msg_date}</span>
          <span className="text-zinc-600">· partira de {account}</span>
        </div>
        {editing ? (
          <div className="mt-2 flex flex-col gap-2">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 focus:border-amber-500/40 focus:outline-none"
              placeholder="Objet"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-200 focus:border-amber-500/40 focus:outline-none"
            />
          </div>
        ) : (
          <>
            <p className="mt-1.5 text-xs font-medium text-zinc-200">{subject || '(sans objet)'}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">{body}</p>
          </>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={send}
            disabled={busy !== false}
            className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
          >
            {busy === 'send' ? '… envoi' : '✅ Envoyer'}
          </button>
          {editing ? (
            <button
              type="button"
              onClick={save}
              disabled={busy !== false}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {busy === 'save' ? '… enregistrement' : '💾 Enregistrer'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy !== false}
              className="rounded-lg border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              ✏️ Modifier
            </button>
          )}
          <button
            type="button"
            onClick={discard}
            disabled={busy !== false}
            className="rounded-lg px-3 py-1 text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50"
          >
            {busy === 'del' ? '…' : '🗑 Supprimer'}
          </button>
          {msg && <span className="text-[11px] text-zinc-300">{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function Composer({ client: c }: { client: CrmClient }) {
  const router = useRouter();
  const [gen, setGen] = useState<GenResult | null>(null);
  const [busy, setBusy] = useState<false | 'gen' | 'send' | 'draft'>(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editable, setEditable] = useState('');

  async function generate() {
    setBusy('gen');
    setMsg(null);
    try {
      const r = await fetch('/api/crm/generate-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: c.account, to: c.email, subject: c.subject, context: c.brief }),
      });
      const d = await r.json();
      if (!r.ok) setMsg(d.message || d.error || 'Échec génération');
      else {
        setGen(d as GenResult);
        setEditable(d.email_en);
      }
    } catch {
      setMsg('Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  async function keepAsDraft() {
    if (!gen) return;
    setBusy('draft');
    setMsg(null);
    try {
      const r = await fetch('/api/crm/draft-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: c.email, subject: gen.subject, body: editable, account: gen.account }),
      });
      if (!r.ok) setMsg('Échec de l’enregistrement du brouillon');
      else {
        setMsg('💾 Gardé en brouillon — il t’attend dans la timeline.');
        setGen(null);
        router.refresh();
      }
    } catch {
      setMsg('Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!gen) return;
    setBusy('send');
    setMsg(null);
    try {
      const r = await fetch('/api/crm/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: gen.account, to: c.email, subject: gen.subject, body: editable }),
      });
      const d = await r.json();
      if (!r.ok) setMsg(d.message || d.error || 'Échec envoi');
      else {
        setMsg('✅ Envoyé et ajouté à la timeline.');
        setGen(null);
        router.refresh(); // re-fetch server data: the sent message now shows immediately
      }
    } catch {
      setMsg('Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-zinc-800/60 pt-4">
      {!gen ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={generate}
            disabled={busy === 'gen'}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
          >
            {busy === 'gen' ? '… génération' : '✍️ Générer une relance'}
          </button>
          <span className="text-[11px] text-zinc-600">
            → {c.account === 'cammac@bluewin.ch' ? 'dans ton fil existant' : 'depuis claude-alain@ibanforge.com'}
          </span>
          {msg && <span className="text-[11px] text-zinc-400">{msg}</span>}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Aperçu — relis, ajuste, envoie</p>
            <button type="button" onClick={() => setGen(null)} className="text-xs text-zinc-500 hover:text-zinc-300">
              annuler
            </button>
          </div>
          <p className="text-xs text-zinc-400">Objet : <span className="text-zinc-200">{gen.subject}</span></p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-amber-400">Mail envoyé (EN) — éditable</p>
              <textarea
                value={editable}
                onChange={(e) => setEditable(e.target.value)}
                rows={10}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-200 focus:border-amber-500/40 focus:outline-none"
              />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-blue-400">Traduction FR (toi seul)</p>
              <div className="h-full whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-400">
                {gen.translation_fr}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={send}
              disabled={busy !== false}
              className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
            >
              {busy === 'send' ? '… envoi' : '✅ Envoyer maintenant'}
            </button>
            <button
              type="button"
              onClick={keepAsDraft}
              disabled={busy !== false}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
              title="Enregistre ce mail dans la timeline du client, sans l'envoyer — tu le relis et l'envoies plus tard"
            >
              {busy === 'draft' ? '… enregistrement' : '💾 Garder en brouillon'}
            </button>
            <span className="text-[11px] text-zinc-500">à {c.email}</span>
            {msg && <span className="text-[11px] text-zinc-300">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
