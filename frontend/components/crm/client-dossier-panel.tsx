'use client';

import Link from 'next/link';
import type { ClientDossier } from '@/lib/crm/client-dossiers';
import { contactsHref } from '@/lib/crm/deep-link';

/** ISO 3166-1 alpha-2 → flag emoji. Anything else renders as the raw code. */
export function flag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function relativeDays(days: number | null): string {
  if (days == null) return 'jamais';
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 31) return `il y a ${days} j`;
  const months = Math.round(days / 30);
  return `il y a ${months} mois`;
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-2 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-4)]">
        {title}
        {note && <span className="font-normal normal-case tracking-normal text-[var(--fg-5)]">{note}</span>}
      </h4>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs italic text-[var(--fg-5)]">{children}</p>;
}

/** A labelled proportional bar. `max` is the row that defines full width. */
function Bar({ label, value, max, tone = 'amber' }: { label: string; value: number; max: number; tone?: 'amber' | 'sky' }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const color = tone === 'amber' ? 'var(--amber-500)' : 'var(--info)';
  return (
    <div className="flex items-center gap-2 py-[3px]">
      <span className="w-40 shrink-0 truncate font-mono text-[11px] text-[var(--fg-3)]" title={label}>
        {label}
      </span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--ink-4)]">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
      <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--fg-2)]">{value}</span>
    </div>
  );
}

/** 90-day call history. Bars, not a line: most customers have gaps, and a line implies days they did not call. */
function Sparkbars({ days }: { days: Array<{ day: string; count: number }> }) {
  if (days.length === 0) return <Empty>Aucun appel sur la période.</Empty>;
  const max = Math.max(...days.map((d) => d.count));
  return (
    <div className="flex h-14 items-end gap-[2px]" aria-hidden>
      {days.map((d) => (
        <span
          key={d.day}
          title={`${d.day} — ${d.count}`}
          className="min-w-[3px] flex-1 rounded-sm bg-[var(--amber-500)]/70"
          style={{ height: `${Math.max(6, (d.count / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** 24 UTC buckets. The shape of someone's day locates them better than a timezone field. */
function HoursStrip({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 1);
  if (hours.every((h) => h === 0)) return <Empty>Pas encore de rythme mesurable.</Empty>;
  return (
    <div>
      <div className="flex h-10 items-end gap-[2px]">
        {hours.map((n, h) => (
          <span
            key={h}
            title={`${String(h).padStart(2, '0')}:00 UTC — ${n}`}
            className="min-w-[3px] flex-1 rounded-sm"
            style={{
              height: `${Math.max(8, (n / max) * 100)}%`,
              backgroundColor: n > 0 ? 'var(--info)' : 'var(--ink-4)',
              opacity: n > 0 ? 0.35 + 0.65 * (n / max) : 1,
            }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-[var(--fg-5)]">
        <span>00h</span>
        <span>06h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h UTC</span>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--fg-5)]">{label}</div>
      <div className="font-mono text-base tabular-nums text-[var(--fg-1)]">{value}</div>
      {hint && <div className="text-[10px] text-[var(--fg-4)]">{hint}</div>}
    </div>
  );
}

export function ClientDossierPanel({ d, locale }: { d: ClientDossier; locale: string }) {
  const errRate = d.requests > 0 ? Math.round(((d.badInput + d.serverError) / d.requests) * 100) : 0;
  const topCountry = d.countries[0];
  const attributed = d.countries.reduce((s, c) => s + c.count, 0);

  return (
    <div className="border-t border-[var(--ink-4)] bg-[var(--ink-1)]/40 px-4 py-5">
      {/* Identity line */}
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono text-sm text-[var(--fg-2)]">{d.email}</span>
        {d.website && (
          <a
            href={d.website}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs text-[var(--amber-400)] underline-offset-2 hover:underline"
          >
            {d.website.replace(/^https?:\/\//, '')} ↗
          </a>
        )}
        {d.country && (
          <span className="text-xs text-[var(--fg-4)]">
            {flag(d.country)} {d.country}
          </span>
        )}
        {d.whatTheyDo && <span className="text-xs italic text-[var(--fg-4)]">{d.whatTheyDo}</span>}
      </div>

      {d.verdict === 'blocked' && (
        <div className="mb-5 rounded-lg border border-[var(--err)]/40 bg-[var(--err)]/10 px-3 py-2 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--err)]">Ils se sont arrêtés sur un refus.</span>{' '}
          Dernier appel servi le {d.lastSuccessAt?.slice(0, 10) ?? '—'}, dernier refus le{' '}
          {d.lastRefusalAt?.slice(0, 10) ?? '—'}, et rien depuis. Relever leur quota ne les prévient pas :
          tant qu&apos;ils n&apos;ont pas réussi un appel, ils croient leur compte fermé.
        </div>
      )}
      {d.verdict === 'struggling' && (
        <div className="mb-5 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn)]">Leur intégration bute.</span> Plus de 30 % de leurs
          appels sont rejetés. Regardez « Ce qui leur est refusé » plus bas : c&apos;est souvent un format d&apos;entrée,
          pas une panne.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Requêtes" value={String(d.requests)} hint={`${d.ok} servies`} />
        <Stat label="Mur payant" value={String(d.paywall + d.authOrQuota)} hint="402 / 401 / 429" />
        <Stat label="Rejets" value={`${errRate} %`} hint={`${d.badInput} en 400`} />
        <Stat label="Latence p95" value={`${d.p95Ms} ms`} hint={`${d.avgMs} ms en moyenne`} />
        <Stat label="Machines" value={String(d.distinctIps)} hint="empreintes IP" />
        <Stat label="Dernier appel" value={relativeDays(d.daysSinceLastCall)} hint={d.firstCallAt ? `depuis le ${d.firstCallAt.slice(0, 10)}` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Activité" note="90 derniers jours">
          <Sparkbars days={d.days} />
        </Section>

        <Section title="Rythme de la journée" note="heures UTC">
          <HoursStrip hours={d.hours} />
        </Section>

        <Section
          title="Pays contrôlés"
          note={attributed > 0 ? `${attributed} contrôles rattachés` : undefined}
        >
          {d.countries.length === 0 ? (
            <Empty>
              Aucun contrôle rattaché. Le rattachement pays↔client existe depuis le 30/07/2026 ; avant cette date
              seules les requêtes isolables ont pu être reconstituées.
            </Empty>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {d.countries.slice(0, 14).map((c) => (
                  <span
                    key={c.code}
                    className="rounded border border-[var(--ink-5)] bg-[var(--ink-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--fg-2)]"
                    title={`${c.count} contrôles`}
                  >
                    {flag(c.code)} {c.code}
                    <span className="ml-1 text-[var(--fg-5)]">{c.count}</span>
                  </span>
                ))}
              </div>
              {topCountry && attributed > 0 && (
                <p className="text-[11px] text-[var(--fg-4)]">
                  {Math.round((topCountry.count / attributed) * 100)} % de leurs contrôles portent sur{' '}
                  <span className="text-[var(--fg-2)]">{topCountry.code}</span>.
                </p>
              )}
            </>
          )}
        </Section>

        <Section title="Types de requêtes">
          {d.endpoints.length === 0 ? (
            <Empty>Aucun appel enregistré.</Empty>
          ) : (
            d.endpoints.slice(0, 8).map((e) => (
              <Bar key={e.path} label={e.path} value={e.count} max={d.endpoints[0].count} />
            ))
          )}
        </Section>

        <Section title="Leur pile technique">
          {d.userAgents.length === 0 ? (
            <Empty>Client non identifié.</Empty>
          ) : (
            <div className="space-y-1">
              {d.userAgents.slice(0, 4).map((u) => (
                <div key={u.ua} className="truncate font-mono text-[11px] text-[var(--fg-3)]" title={u.ua}>
                  {u.ua} <span className="text-[var(--fg-5)]">· {u.count}</span>
                </div>
              ))}
              {d.clientKinds.length > 0 && (
                <div className="pt-1 text-[11px] text-[var(--fg-4)]">
                  {d.clientKinds.map((k) => `${k.kind} (${k.count})`).join(' · ')}
                </div>
              )}
            </div>
          )}
        </Section>

        <Section title="Ce qui leur est refusé">
          {d.rejectReasons.length === 0 ? (
            <Empty>Aucun rejet de format enregistré.</Empty>
          ) : (
            d.rejectReasons.map((r) => (
              <Bar key={r.reason} label={r.reason} value={r.count} max={d.rejectReasons[0].count} tone="sky" />
            ))
          )}
        </Section>

        <Section title="Clés et quota">
          <div className="space-y-2">
            {d.keys.map((k) => {
              const limit = k.creditsTotal ?? k.monthlyLimit ?? 200;
              const used = k.creditsTotal != null ? k.creditsTotal - (k.creditsRemaining ?? 0) : k.usedThisMonth;
              const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
              return (
                <div key={k.prefix} className="rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-[var(--fg-2)]">{k.prefix}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="rounded border border-[var(--ink-5)] px-1 py-px text-[10px] uppercase text-[var(--fg-4)]">
                        {k.plan === 'credits' ? 'crédits' : k.plan === 'paid' ? 'payant' : 'gratuit'}
                      </span>
                      {!k.active && <span className="text-[10px] text-[var(--err)]">révoquée</span>}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--ink-4)]">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? 'var(--err)' : pct >= 80 ? 'var(--warn)' : 'var(--ok)' }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--fg-4)]">
                    <span>
                      {used} / {limit} {k.creditsTotal != null ? 'crédits' : 'ce mois'}
                    </span>
                    <span>créée le {k.createdAt.slice(0, 10)}</span>
                  </div>
                  {k.quotaWarnedMonths.length > 0 && (
                    <div className="mt-1 text-[10px] text-[var(--warn)]">
                      Avertie à 80 % en {k.quotaWarnedMonths.join(', ')}
                    </div>
                  )}
                  {k.months.length > 1 && (
                    <div className="mt-1 font-mono text-[10px] text-[var(--fg-5)]">
                      {k.months.map((m) => `${m.month.slice(5)} : ${m.count}`).join('  ·  ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Échanges">
          {d.mails.sent + d.mails.received === 0 ? (
            <Empty>Jamais contacté.</Empty>
          ) : (
            <div className="space-y-1 text-[11px] text-[var(--fg-3)]">
              <div>
                <span className="font-mono text-[var(--fg-2)]">{d.mails.sent}</span> envoyé
                {d.mails.sent > 1 ? 's' : ''} ·{' '}
                <span className="font-mono text-[var(--fg-2)]">{d.mails.received}</span> reçu
                {d.mails.received > 1 ? 's' : ''}
              </div>
              {d.mails.lastAt && (
                <div>
                  Dernier le <span className="text-[var(--fg-2)]">{d.mails.lastAt.slice(0, 10)}</span>
                  {d.mails.lastSubject && <> · « {d.mails.lastSubject} »</>}
                </div>
              )}
            </div>
          )}
          {d.mails.hasDraft && (
            <div className="mt-2 rounded border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-2 py-1 text-[11px] text-[var(--warn)]">
              Un brouillon attend d&apos;être envoyé.
            </div>
          )}
          <Link
            href={contactsHref(locale, d.id)}
            className="mt-2 inline-block text-[11px] text-[var(--amber-400)] underline-offset-2 hover:underline"
          >
            Ouvrir le fil dans Contacts →
          </Link>
        </Section>
      </div>
    </div>
  );
}
