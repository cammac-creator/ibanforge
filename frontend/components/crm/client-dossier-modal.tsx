'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { toZurich } from '@/lib/crm/zurich';
import {
  chipOfDossier,
  heatOfDossier,
  parseUtc,
  qualityTrend,
  calendarDaysSince,
  stateOfDossier,
  type ClientDossier,
} from '@/lib/crm/client-dossiers';
import { botsHref, contactsHref } from '@/lib/crm/deep-link';
import { Bar, Empty, HoursStrip, Section, Stat, flag, relativeDays } from './dossier-bits';
import { ConquestChip } from './conquest-chip';
import { ContactNotes } from './contact-notes';
import { ActivityChart } from './activity-chart';
import { RaiseLimitControl } from './raise-limit-control';
import { NUANCE_BY_KEY, STATE_BY_KEY } from './verdict-meta';

/**
 * The dossier as a window over the page: click a row, the customer's whole
 * story opens on top of the list; click beside it (or Échap) and you are back.
 * Replaces both previous homes (inline accordion + xl side rail), which split
 * the layout in two and buried half the facts at half the width.
 */

/** Deterministic identity colour: one address, one hue, every visit. */
function hueOf(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function initialsOf(d: ClientDossier): string {
  const source = d.company ?? d.email.split('@')[1] ?? d.email;
  const words = source.split(/[\s.\-_@]+/).filter(Boolean);
  const two = words.length >= 2 ? words[0][0] + words[1][0] : source.slice(0, 2);
  return two.toUpperCase();
}

function shortDate(raw: string | null): string | null {
  const t = parseUtc(raw);
  if (!t) return null;
  const [year, month, day] = toZurich(t.toISOString()).slice(0, 10).split('-');
  return `${day}.${month}.${year.slice(-2)}`;
}

/** The relationship's milestones on one line: signup → first call → today. */
function Journey({ d, now }: { d: ClientDossier; now: Date }) {
  const raw: Array<{ label: string; at: string | null; colour: string }> = [
    { label: 'Inscription', at: d.signedUpAt, colour: 'var(--fg-4)' },
    { label: '1er appel', at: d.firstCallEver ?? d.firstCallAt, colour: 'var(--info)' },
    { label: 'Succès · période', at: d.lastSuccessAt, colour: 'var(--ok)' },
    { label: 'Refus · période', at: d.lastRefusalAt, colour: 'var(--err)' },
    { label: 'Dernier mail', at: d.mails.lastAt, colour: 'var(--amber-400, #fbbf24)' },
  ];
  const steps = raw
    .map((s) => ({ ...s, t: parseUtc(s.at) }))
    .filter((s): s is typeof s & { t: Date } => s.t != null)
    .sort((a, b) => a.t.getTime() - b.t.getTime());
  if (steps.length < 2) return null;
  return (
    <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-start">
        {steps.map((s, i) => (
          <div key={`${s.label}-${i}`} className="relative min-w-[104px] flex-1 px-1 pt-4">
            {/* the thread of the story, drawn from dot to dot */}
            {i > 0 && (
              <span
                className="absolute right-1/2 top-[7px] h-px w-full bg-[var(--ink-4)]"
                aria-hidden
              />
            )}
            <span
              className="absolute left-1/2 top-1 h-[9px] w-[9px] -translate-x-1/2 rounded-full ring-4 ring-[var(--ink-1)]"
              style={{ backgroundColor: s.colour }}
              aria-hidden
            />
            <div className="text-center">
              <div className="text-[11px] font-medium text-[var(--fg-3)]">{s.label}</div>
              <div
                className="font-mono text-[11px] tabular-nums text-[var(--fg-5)]"
                title={s.at ?? undefined}
              >
                {shortDate(s.at)}
              </div>
              <div className="text-[10.5px] text-[var(--fg-5)]">
                {relativeDays(calendarDaysSince(s.t, now))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ClientDossierModal({
  d,
  locale,
  windowDays = 90,
  readAtIso,
  onClose,
}: {
  d: ClientDossier;
  locale: string;
  windowDays?: number;
  readAtIso: string;
  onClose: () => void;
}) {
  const now = new Date(readAtIso);
  const dialogRef = useRef<HTMLDivElement>(null);
  const errRate =
    d.requests > 0 ? Math.round((d.badInput / d.requests) * 100) : null;
  const topCountry = d.countries[0];
  const attributed = d.countries.reduce((s, c) => s + c.count, 0);
  const quality = qualityTrend(d, now);
  const chip = chipOfDossier(d);
  const heat = heatOfDossier(d, now);
  // The same one-word-plus-precision the table row shows, from the same
  // function (audit TABS-01 and TABS-09, 2026-09-01). A dossier that read
  // "Actif" in the list and "Endormi" once opened was the most visible half of
  // the two-vocabulary defect.
  const state = stateOfDossier(d);
  const verdict = STATE_BY_KEY[state.status];
  const nuance = state.nuance ? NUANCE_BY_KEY[state.nuance] : null;
  const hue = hueOf(d.email);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('summary, button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
    focusables()[0]?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const controls = focusables();
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKey);
    // The list must not scroll under the modal; restore on close.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-[2px] sm:p-6 sm:pt-[4.5vh]"
      onClick={onClose}
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Dossier de ${d.company ?? d.email}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-3xl border-[var(--ink-4)] bg-[var(--ink-1)] shadow-[0_24px_80px_rgba(23,35,44,0.18)] sm:rounded-2xl sm:border"
      >
        {/* ---- identity banner ---- */}
        <div
          className="relative overflow-hidden border-b border-[var(--ink-4)] px-4 pb-4 pt-4 sm:rounded-t-2xl sm:px-6 sm:pt-5"
          style={{
            background: `linear-gradient(135deg, hsl(${hue} 35% 94%), var(--ink-1) 55%)`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le dossier"
            className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-md border border-[var(--ink-5)] px-2 py-0.5 text-[13px] text-[var(--fg-3)] transition-colors hover:border-[var(--fg-4)] hover:text-[var(--fg-1)]"
          >
            ✕
          </button>

          <div className="flex min-w-0 items-start gap-3.5 pr-10">
            <span
              aria-hidden
              className="flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-xl text-lg font-black tracking-tight text-white/90 shadow-inner"
              style={{
                background: `linear-gradient(135deg, hsl(${hue} 65% 42%), hsl(${(hue + 42) % 360} 60% 28%))`,
              }}
            >
              {initialsOf(d)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 truncate text-[17px] font-semibold text-[var(--fg-1)]">
                  {d.company ?? d.email.split('@')[1]}
                </span>
                {chip && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{ color: chip.color, backgroundColor: chip.bg }}
                  >
                    {chip.label}
                  </span>
                )}
                {d.wonByOutreach && <ConquestChip />}
                {heat.score >= 40 && (
                  <span
                    className="shrink-0 text-[12px]"
                    title={heat.parts
                      .map((p) => `${p.label} ${p.points > 0 ? '+' : ''}${p.points}`)
                      .join(' · ')}
                  >
                    🔥 {heat.score}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="min-w-0 truncate font-mono text-[12.5px] text-[var(--fg-3)]">
                  {d.email}
                </span>
                {d.website && (
                  <a
                    href={d.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="shrink-0 text-[12.5px] text-[var(--amber-400)] underline-offset-2 hover:underline"
                  >
                    site ↗
                  </a>
                )}
                {d.country && (
                  <span className="shrink-0 text-[12.5px] text-[var(--fg-4)]">
                    {flag(d.country)} {d.country}
                  </span>
                )}
              </div>
              {d.whatTheyDo && (
                <p className="mt-1 text-[12.5px] italic leading-snug text-[var(--fg-4)]">
                  {d.whatTheyDo}
                </p>
              )}
            </div>
          </div>

          {/* state + primary gesture, always visible without scrolling */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-medium"
              style={{
                color: verdict.colour,
                borderColor: 'color-mix(in srgb, currentColor 35%, transparent)',
              }}
              title={verdict.why}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: verdict.colour }}
              />
              {verdict.one}
              {state.derived ? '°' : ''}
            </span>
            {nuance && (
              <span
                className="inline-flex shrink-0 items-center rounded-full border border-[var(--ink-4)] px-2 py-0.5 text-[12px] text-[var(--fg-3)]"
                title={nuance.why}
              >
                {nuance.one}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--fg-4)]">
              {nuance ? nuance.why : verdict.why}
            </span>
            <Link
              href={contactsHref(locale, d.id)}
              className="shrink-0 rounded-md border border-[var(--amber-500)]/40 px-2.5 py-1 text-[12.5px] font-medium text-[var(--amber-400)] hover:bg-[var(--amber-500)]/10"
            >
              ✉ Écrire
            </Link>
          </div>
        </div>

        {/* ---- body ---- */}
        <div className="space-y-6 px-4 py-5 sm:px-6">
          <Journey d={d} now={now} />

          {d.verdict === 'blocked' && (
            <div className="rounded-lg border border-red-500/35 bg-red-500/[0.07] px-3 py-2.5">
              <p className="text-[13px] leading-snug text-red-200">
                ⛔ <b>Arrêté sur un refus</b>
                {d.lastRefusalAt ? ` le ${d.lastRefusalAt.slice(0, 10)}` : ''} :{' '}
                {d.authOrQuota > 0 ? `${d.authOrQuota} quota/auth (401/429)` : ''}
                {d.authOrQuota > 0 && d.paywall > 0 ? ' · ' : ''}
                {d.paywall > 0 ? `${d.paywall} paywall (402)` : ''}
                {d.rejectReasons[0] ? ` · motif : ${d.rejectReasons[0].reason}` : ''}. Dernier appel
                servi sur la période le {d.lastSuccessAt?.slice(0, 10) ?? '—'}. Vérifier si ce refus bloque encore leur utilisation.
              </p>
              {d.keys
                .filter((k) => k.plan === 'free' && k.active)
                .map((k) => (
                  <RaiseLimitControl
                    key={k.prefix}
                    prefix={k.prefix}
                    currentLimit={k.monthlyLimit ?? 200}
                  />
                ))}
            </div>
          )}
          {d.verdict === 'struggling' && (
            <div className="rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2 text-[13px] leading-snug text-[var(--fg-2)]">
              <span className="font-semibold text-[var(--warn)]">Leur intégration bute</span> — plus
              de 30 % d&apos;appels rejetés. Voir « Ce qui leur est refusé » : souvent un format
              d&apos;entrée, pas une panne.
            </div>
          )}
          {quality && (quality.thisWeekPct >= 10 || quality.prevWeekPct >= 10) && (
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[12.5px] leading-snug text-amber-950">
              ⚠ Qualité : <b>{quality.thisWeekPct} %</b> d’entrées rejetées sur les 7 journées UTC complètes, contre{' '}
              <b>{quality.prevWeekPct} %</b> sur les 7 précédentes
              {quality.topReason ? (
                <>
                  {' '}
                  · principal motif sur toute la période : <span className="font-mono">{quality.topReason}</span>
                </>
              ) : null}
              {quality.thisWeekPct > quality.prevWeekPct + 5
                ? ' — intégration qui régresse, un mail d’aide vaut le coup.'
                : quality.thisWeekPct < quality.prevWeekPct - 5
                  ? ' — en amélioration.'
                  : ''}
            </p>
          )}

          <p className="text-xs leading-relaxed text-[var(--fg-4)]">Activité sur {windowDays} journées UTC, aujourd’hui inclus et incomplet. Les dates de relation sont affichées en heure suisse ; les quotas et l’historique mensuel gardent leur propre période.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat
              label="Requêtes"
              value={String(d.requests)}
              hint={`${d.ok} servies · ${windowDays} j`}
            />
            <Stat
              label="Refus d’accès"
              value={String(d.paywall + d.authOrQuota)}
              hint="paiement, authentification ou quota"
            />
            <Stat label="Entrées rejetées" value={errRate === null ? '—' : `${errRate} %`} hint={`${d.badInput} réponses HTTP 400`} />
            <Stat label="Erreurs serveur" value={String(d.serverError)} hint="réponses HTTP 5xx sur la période" />
            <Stat label="Temps de réponse p95" value={d.requests ? `${d.p95Ms} ms` : '—'} hint={`p95 le plus élevé des clés · moyenne ${d.avgMs} ms`} />
            <Stat label="Empreintes réseau" value={String(d.distinctIps)} hint="somme par clé · doublons possibles" />
            <Stat
              label="Dernier appel"
              value={
                d.daysSinceLastCall == null && d.usedAllTime > 0
                  ? `rien sur ${windowDays} j`
                  : relativeDays(d.daysSinceLastCall)
              }
              hint={
                d.firstCallEver
                  ? `1er appel le ${d.firstCallEver.slice(0, 10)}`
                  : d.firstCallAt
                    ? `vu depuis le ${d.firstCallAt.slice(0, 10)}`
                    : undefined
              }
            />
          </div>

          <Section title="Activité" note="jours UTC · historique mensuel séparé">
            <ActivityChart
              a={{
                email: d.email,
                observedAt: readAtIso,
                uid: d.id,
                days: d.days,
                months: d.keys.flatMap((k) => k.months ?? []),
              }}
            />
          </Section>

          <Section title="Rythme de la journée" note="heures UTC">
            <HoursStrip hours={d.hours} />
          </Section>

          <div className="grid gap-6 sm:grid-cols-2">
            <Section
              title="Pays contrôlés"
              note={attributed > 0 ? `${attributed} rattachés` : undefined}
            >
              {d.countries.length === 0 ? (
                <Empty>
                  Aucun contrôle rattaché. Le rattachement pays↔client existe depuis le 30/07/2026 ;
                  avant cette date seules les requêtes isolables ont pu être reconstituées.
                </Empty>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {d.countries.slice(0, 14).map((c) => (
                      <span
                        key={c.code}
                        className="rounded border border-[var(--ink-5)] bg-[var(--ink-2)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--fg-2)]"
                        title={`${c.count} contrôles`}
                      >
                        {flag(c.code)} {c.code}
                        <span className="ml-1 text-[var(--fg-5)]">{c.count}</span>
                      </span>
                    ))}
                  </div>
                  {topCountry && attributed > 0 && (
                    <p className="text-[12px] text-[var(--fg-4)]">
                      {Math.round((topCountry.count / attributed) * 100)} % portent sur{' '}
                      <span className="text-[var(--fg-2)]">{topCountry.code}</span>.
                    </p>
                  )}
                </>
              )}
            </Section>

            <Section title="Principaux types de requêtes">
              {d.endpoints.length === 0 ? (
                <Empty>Aucun appel enregistré.</Empty>
              ) : (
                d.endpoints
                  .slice(0, 8)
                  .map((e) => (
                    <Bar key={e.path} label={e.path} value={e.count} max={d.endpoints[0].count} />
                  ))
              )}
            </Section>

            {d.rejectReasons.length > 0 && (
              <Section title="Ce qui leur est refusé">
                {d.rejectReasons.slice(0, 6).map((r) => (
                  <Bar
                    key={r.reason}
                    label={r.reason}
                    value={r.count}
                    max={d.rejectReasons[0].count}
                    tone="sky"
                  />
                ))}
              </Section>
            )}

            {d.userAgents.length > 0 && (
              <Section title="Principaux agents déclarés" note="cliquer ouvre l'agent dans Clients Bot">
                <div className="space-y-1">
                  {/* Each agent links to the anonymous side. The tool a customer
                      automates with is very often the one that probed us without
                      a key first, and that crossing is only visible from here. */}
                  {d.userAgents.slice(0, 4).map((u) => (
                    <a
                      key={u.ua}
                      href={botsHref(locale, u.ua)}
                      title={`${u.ua} — voir cet agent côté Clients Bot`}
                      className="block truncate font-mono text-[12px] text-[var(--fg-3)] hover:text-amber-400 hover:underline"
                    >
                      {u.ua} <span className="text-[var(--fg-5)]">· {u.count}</span>
                    </a>
                  ))}
                  {d.clientKinds.length > 0 && (
                    <div className="pt-1 text-[12px] text-[var(--fg-4)]">
                      {d.clientKinds.map((k) => `${k.kind} (${k.count})`).join(' · ')}
                    </div>
                  )}
                </div>
              </Section>
            )}
          </div>

          <Section title="Clés et quota" note="mois en cours ou solde du pack">
            <div className="grid gap-2 sm:grid-cols-2">
              {d.keys.map((k) => {
                const limit = k.creditsTotal ?? k.monthlyLimit ?? 200;
                const used =
                  k.creditsTotal != null
                    ? k.creditsTotal - (k.creditsRemaining ?? 0)
                    : k.usedThisMonth;
                const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                return (
                  <div
                    key={k.prefix}
                    className="rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-mono text-[12px] text-[var(--fg-2)]">
                        {k.prefix}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded border border-[var(--ink-5)] px-1 py-px text-[11px] uppercase text-[var(--fg-4)]">
                          {k.plan === 'credits'
                            ? 'crédits'
                            : k.plan === 'paid'
                              ? 'payant'
                              : 'gratuit'}
                        </span>
                        {!k.active && (
                          <span className="text-[12px] text-[var(--err)]">révoquée</span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--ink-4)]">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor:
                            pct >= 100 ? 'var(--err)' : pct >= 80 ? 'var(--warn)' : 'var(--ok)',
                        }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between font-mono text-[12px] text-[var(--fg-4)]">
                      <span>
                        {used} / {limit} {k.creditsTotal != null ? 'crédits' : 'ce mois'}
                      </span>
                      <span>créée le {k.createdAt.slice(0, 10)}</span>
                    </div>
                    {k.quotaWarnedMonths.length > 0 && (
                      <div className="mt-1 text-[12px] text-[var(--warn)]">
                        Avertie à 80 % en {k.quotaWarnedMonths.join(', ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          <div className="grid gap-6 sm:grid-cols-2">
            <Section title="Échanges">
              {d.mails.sent + d.mails.received === 0 ? (
                <Empty>Jamais contacté.</Empty>
              ) : (
                <div className="space-y-1 text-[12.5px] text-[var(--fg-3)]">
                  <div>
                    <span className="font-mono text-[var(--fg-2)]">{d.mails.sent}</span> envoyé
                    {d.mails.sent > 1 ? 's' : ''} ·{' '}
                    <span className="font-mono text-[var(--fg-2)]">{d.mails.received}</span> reçu
                    {d.mails.received > 1 ? 's' : ''}
                  </div>
                  {d.mails.lastAt && (
                    <div className="min-w-0 truncate">
                      Dernier le{' '}
                      <span className="text-[var(--fg-2)]">{d.mails.lastAt.slice(0, 10)}</span>
                      {d.mails.lastSubject && <> · « {d.mails.lastSubject} »</>}
                    </div>
                  )}
                </div>
              )}
              {d.mails.hasDraft && (
                <div className="mt-2 rounded border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-2 py-1 text-[12px] text-[var(--warn)]">
                  Un brouillon attend d&apos;être envoyé.
                </div>
              )}
            </Section>

            <Section title="Notes">
              <ContactNotes email={d.email} />
            </Section>
          </div>
        </div>

        <div className="border-t border-[var(--ink-4)] px-4 py-2 text-center text-[10.5px] text-[var(--fg-5)] sm:rounded-b-2xl sm:px-6">
          ↑↓ passe au client suivant · Échap ou un clic à côté ferme
        </div>
      </div>
    </div>
  );
}
