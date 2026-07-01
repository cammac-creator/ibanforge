'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TimelineMessage, type CrmMessage } from './crm-workspace';

export interface Prospect {
  id: string;
  company: string;
  segment: string | null;
  website: string | null;
  country: string | null;
  what_they_do: string | null;
  fit_reason: string | null;
  buying_signal: string | null;
  signal_source_url: string | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_email: string | null;
  email_source_url: string | null;
  personalization_hook: string | null;
  confidence: string | null;
  status: string;
  mail_subject_en: string | null;
  mail_body_en: string | null;
  mail_subject_fr: string | null;
  mail_body_fr: string | null;
  recommended_lang: string | null;
  source: string | null;
  messages: CrmMessage[];
  contacted: boolean;
  replied: boolean;
  lastTouch: string | null;
}

const COLD_ACCOUNT = 'claude-alain@ibanforge.com';

const SEGMENT: Record<string, { label: string; dot: string }> = {
  'x402-mcp': { label: 'x402 / MCP / agents IA', dot: '#8b5cf6' },
  editeurs: { label: 'Éditeur logiciel CH/EU', dot: '#0ea5e9' },
  'api-concurrentes': { label: 'Migration API concurrente', dot: '#22c55e' },
  fintech: { label: 'Fintech / PSP / néobanque', dot: '#f59e0b' },
};
function seg(s: string | null) {
  return (s && SEGMENT[s]) || { label: s || 'Autre', dot: '#a1a1aa' };
}

type DisplayStatus = 'a_mailer' | 'a_enrichir' | 'contacte' | 'followup_due' | 'replied' | 'archive';
function displayStatus(p: Prospect): DisplayStatus {
  if (p.replied) return 'replied';
  if (p.contacted) {
    const last = p.messages[p.messages.length - 1];
    const d = last?.msg_date ? Math.floor((Date.now() - new Date(last.msg_date).getTime()) / 86_400_000) : 0;
    // Relance due seulement après une vraie fenêtre de suivi (10 j) sans réponse.
    return d > 10 ? 'followup_due' : 'contacte';
  }
  if (p.status === 'archive') return 'archive';
  if (p.status === 'a_mailer') return 'a_mailer';
  return 'a_enrichir';
}
const PSTATUS: Record<DisplayStatus, { label: string; color: string; bg: string }> = {
  a_mailer: { label: 'À mailer', color: '#22c55e', bg: '#052e16' },
  a_enrichir: { label: 'À enrichir', color: '#f59e0b', bg: '#451a03' },
  contacte: { label: 'Contacté', color: '#3b82f6', bg: '#172554' },
  followup_due: { label: 'Relance due', color: '#f59e0b', bg: '#451a03' },
  replied: { label: 'A répondu', color: '#22c55e', bg: '#052e16' },
  archive: { label: 'Archivé', color: '#a1a1aa', bg: '#27272a' },
};
const CONF: Record<string, string> = { high: '#22c55e', medium: '#f59e0b', low: '#ef4444' };

export function ProspectsWorkspace({ prospects }: { prospects: Prospect[] }) {
  const [segFilter, setSegFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'actifs' | 'a_mailer' | 'contactes' | 'archive'>('actifs');
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<string | null>(prospects[0]?.id ?? null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return prospects.filter((p) => {
      const ds = displayStatus(p);
      if (statusFilter === 'actifs' && ds === 'archive') return false;
      if (statusFilter === 'a_mailer' && ds !== 'a_mailer') return false;
      if (statusFilter === 'contactes' && ds !== 'contacte' && ds !== 'replied' && ds !== 'followup_due') return false;
      if (statusFilter === 'archive' && ds !== 'archive') return false;
      if (segFilter !== 'all' && p.segment !== segFilter) return false;
      if (term && !`${p.company} ${p.contact_email ?? ''} ${p.country ?? ''}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [prospects, segFilter, statusFilter, q]);

  const sel = prospects.find((p) => p.id === selId) ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      {/* LEFT — prospect list */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40">
        <div className="space-y-2 border-b border-zinc-800/60 p-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un prospect…"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/40 focus:outline-none"
          />
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['actifs', 'Actifs'],
                ['a_mailer', 'À mailer'],
                ['contactes', 'Contactés'],
                ['archive', 'Archivés'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatusFilter(k)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${statusFilter === k ? 'bg-amber-500/15 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <select
            value={segFilter}
            onChange={(e) => setSegFilter(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 focus:border-amber-500/40 focus:outline-none"
          >
            <option value="all">Tous les segments</option>
            {Object.entries(SEGMENT).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {filtered.length === 0 && <p className="p-4 text-sm text-zinc-600">Aucun prospect.</p>}
          {filtered.map((p) => {
            const ds = displayStatus(p);
            const st = PSTATUS[ds];
            const sg = seg(p.segment);
            const active = p.id === selId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelId(p.id)}
                className={`flex w-full flex-col gap-1 border-b border-zinc-800/40 px-3 py-2.5 text-left transition-colors ${active ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: sg.dot }} />
                  <span className="truncate text-sm font-medium text-zinc-200">{p.company}</span>
                  {p.country && <span className="ml-auto shrink-0 text-[10px] text-zinc-600">{p.country}</span>}
                </div>
                <div className="flex items-center gap-2 pl-4">
                  <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style={{ color: st.color, backgroundColor: st.bg }}>
                    {st.label}
                  </span>
                  <span className="truncate text-[10px] text-zinc-600">{sg.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT — detail */}
      <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
        {!sel ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-600">Sélectionne un prospect à gauche.</div>
        ) : (
          <ProspectDetail key={sel.id} p={sel} />
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-0.5 text-sm text-zinc-300">{children || '—'}</p>
    </div>
  );
}

function ProspectDetail({ p }: { p: Prospect }) {
  const sg = seg(p.segment);
  const ds = displayStatus(p);
  const st = PSTATUS[ds];
  return (
    <div className="flex flex-col gap-5">
      {/* identity */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800/60 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: sg.dot }} />
            <h2 className="text-lg font-semibold text-white">{p.company}</h2>
            {p.website && (
              <a href={p.website} target="_blank" rel="noreferrer" className="text-xs text-amber-400 hover:underline">
                site ↗
              </a>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            {sg.label}
            {p.country ? ` · ${p.country}` : ''}
            {p.confidence ? (
              <>
                {' · '}
                <span style={{ color: CONF[p.confidence] ?? '#a1a1aa' }}>confiance {p.confidence}</span>
              </>
            ) : null}
          </p>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ color: st.color, backgroundColor: st.bg }}>
          {st.label}
        </span>
      </div>

      {/* why this prospect */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ce qu'ils font">{p.what_they_do}</Field>
        <Field label="Pourquoi IBANforge leur sert">{p.fit_reason}</Field>
      </div>

      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-emerald-500/70">Signal d’achat</p>
        <p className="mt-0.5 text-sm text-emerald-100">{p.buying_signal || '—'}</p>
        {p.signal_source_url && (
          <a href={p.signal_source_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] text-emerald-400 hover:underline">
            preuve ↗
          </a>
        )}
      </div>

      {/* contact */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Contact</p>
        <p className="mt-0.5 text-zinc-200">
          {p.contact_name || '—'}
          {p.contact_role ? ` · ${p.contact_role}` : ''}
        </p>
        {p.contact_email ? (
          <p className="text-xs text-zinc-400">
            {p.contact_email}
            {p.email_source_url && (
              <>
                {' · '}
                <a href={p.email_source_url} target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">
                  source ↗
                </a>
              </>
            )}
            {p.status === 'a_enrichir' && <span className="text-amber-400/70"> · à confirmer (non vérifié)</span>}
          </p>
        ) : (
          <p className="text-xs text-amber-400/80">Pas d’email vérifié — à enrichir (on ne devine jamais une adresse).</p>
        )}
        {p.personalization_hook && (
          <p className="mt-1 text-[11px] text-zinc-500">
            <span className="text-zinc-400">Accroche :</span> {p.personalization_hook}
          </p>
        )}
      </div>

      <ProspectTimeline p={p} />
      <ProspectComposer p={p} />
      <StatusActions p={p} />
    </div>
  );
}

function ProspectTimeline({ p }: { p: Prospect }) {
  if (!p.messages.length) {
    return (
      <div className="border-t border-zinc-800/60 pt-4">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">Conversation</p>
        <p className="text-sm text-zinc-600">
          Aucun échange pour l’instant. Le mail que tu envoies s’ajoute ici, et les réponses remontent
          automatiquement (synchro des boîtes toutes les 15 min).
        </p>
      </div>
    );
  }
  return (
    <div className="border-t border-zinc-800/60 pt-4">
      <p className="mb-3 text-[11px] uppercase tracking-wide text-zinc-500">Conversation ({p.messages.length})</p>
      <div className="relative flex flex-col gap-3 border-l border-zinc-800 pl-4">
        {p.messages.map((m, i) => (
          <TimelineMessage key={i} m={m} />
        ))}
      </div>
    </div>
  );
}

function ProspectComposer({ p }: { p: Prospect }) {
  const router = useRouter();
  const recFr = (p.recommended_lang ?? 'en') === 'fr';
  const pick = (l: 'fr' | 'en', kind: 'subject' | 'body') =>
    (l === 'fr' ? (kind === 'subject' ? p.mail_subject_fr : p.mail_body_fr) : kind === 'subject' ? p.mail_subject_en : p.mail_body_en) ?? '';

  const [lang, setLang] = useState<'fr' | 'en'>(recFr ? 'fr' : 'en');
  const [subject, setSubject] = useState(pick(recFr ? 'fr' : 'en', 'subject'));
  const [bodyTxt, setBodyTxt] = useState(pick(recFr ? 'fr' : 'en', 'body'));
  const [busy, setBusy] = useState<false | 'send' | 'draft'>(false);
  const [msg, setMsg] = useState<string | null>(null);

  function switchLang(l: 'fr' | 'en') {
    setLang(l);
    setSubject(pick(l, 'subject'));
    setBodyTxt(pick(l, 'body'));
  }

  const noMail = !p.mail_body_en && !p.mail_body_fr;
  const canSend = !!p.contact_email && !!bodyTxt.trim() && !!subject.trim() && busy === false;

  async function send() {
    if (!p.contact_email) return;
    setBusy('send');
    setMsg(null);
    try {
      const r = await fetch('/api/crm/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: COLD_ACCOUNT, to: p.contact_email, subject, body: bodyTxt }),
      });
      const d = await r.json();
      if (!r.ok) setMsg(d.message || d.error || 'Échec envoi');
      else {
        setMsg('✅ Envoyé et ajouté à la timeline.');
        router.refresh();
      }
    } catch {
      setMsg('Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  async function draft() {
    if (!p.contact_email) return;
    setBusy('draft');
    setMsg(null);
    const brief = [
      `Prospect: ${p.company} (${p.country ?? ''}) <${p.contact_email}>`,
      `What they do: ${p.what_they_do ?? ''}`,
      `Why IBANforge fits: ${p.fit_reason ?? ''}`,
      `Personalization hook (use it verbatim as the opener): ${p.personalization_hook ?? ''}`,
      `Buying signal: ${p.buying_signal ?? ''}`,
      'This is a COLD 1:1 outreach. Plain text, at most ONE link (https://ibanforge.com), 90-140 words, clear signature "Claude-Alain Martin — IBANforge — https://ibanforge.com", a polite opt-out as the last line, no spam words. Base it closely on this pre-written draft:',
      '',
      bodyTxt,
    ].join('\n');
    try {
      const r = await fetch('/api/crm/generate-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: COLD_ACCOUNT, to: p.contact_email, subject, context: brief }),
      });
      const d = await r.json();
      if (!r.ok) setMsg(d.message || d.error || 'Échec dépôt brouillon');
      else setMsg(`📥 Brouillon déposé dans « ${d.deposited_in ?? 'Brouillons'} » de ${d.account ?? COLD_ACCOUNT} — relis dans ta boîte puis envoie.`);
    } catch {
      setMsg('Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  if (noMail) {
    return (
      <div className="border-t border-zinc-800/60 pt-4 text-sm text-amber-300/90">
        Pas encore de mail rédigé (souvent parce qu’aucun email vérifié n’a été trouvé). Enrichis l’email, puis génère le mail.
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-800/60 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-zinc-500">Mail prêt — relis, ajuste, envoie</p>
        <div className="flex gap-1">
          {(['fr', 'en'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => switchLang(l)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${lang === l ? 'bg-amber-500/15 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {l.toUpperCase()}
              {(p.recommended_lang ?? 'en') === l ? ' ✓' : ''}
            </button>
          ))}
        </div>
      </div>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Objet"
        className="mb-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-amber-500/40 focus:outline-none"
      />
      <textarea
        value={bodyTxt}
        onChange={(e) => setBodyTxt(e.target.value)}
        rows={11}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-200 focus:border-amber-500/40 focus:outline-none"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
        >
          {busy === 'send' ? '… envoi' : '✅ Envoyer'}
        </button>
        <button
          type="button"
          onClick={draft}
          disabled={!p.contact_email || busy !== false}
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
          title="Déposer un brouillon (IA) dans ta boîte ibanforge pour relire avant d'envoyer"
        >
          {busy === 'draft' ? '… dépôt' : '📥 Déposer en brouillon'}
        </button>
        <span className="text-[11px] text-zinc-500">{p.contact_email ? `→ ${p.contact_email}` : 'email manquant'}</span>
      </div>
      {!p.contact_email && <p className="mt-1 text-[11px] text-amber-400/80">Ajoute d’abord un email vérifié pour activer l’envoi.</p>}
      {msg && <p className="mt-2 text-[11px] text-zinc-300">{msg}</p>}
    </div>
  );
}

function StatusActions({ p }: { p: Prospect }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function setStatus(status: string) {
    setBusy(true);
    try {
      await fetch('/api/crm/prospect-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, status }),
      });
      router.refresh();
    } catch {
      /* best-effort */
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800/60 pt-3 text-[11px]">
      <span className="text-zinc-600">Classer :</span>
      <button type="button" disabled={busy} onClick={() => setStatus('archive')} className="text-zinc-500 hover:text-zinc-300 disabled:opacity-50">
        archiver
      </button>
      <button type="button" disabled={busy} onClick={() => setStatus('rejete')} className="text-zinc-500 hover:text-red-400 disabled:opacity-50">
        rejeter
      </button>
      {p.status !== 'a_mailer' && p.contact_email && (
        <button type="button" disabled={busy} onClick={() => setStatus('a_mailer')} className="text-zinc-500 hover:text-emerald-400 disabled:opacity-50">
          marquer à mailer
        </button>
      )}
    </div>
  );
}
