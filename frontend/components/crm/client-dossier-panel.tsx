'use client';

import Link from 'next/link';
import { chipOfDossier, heatOfDossier, qualityTrend, type ClientDossier } from '@/lib/crm/client-dossiers';
import { contactsHref } from '@/lib/crm/deep-link';
import { Bar, Empty, HoursStrip, Section, Sparkbars, Stat, flag, relativeDays } from './dossier-bits';

/**
 * One dossier, two homes. `full` is the inline accordion under a row, with
 * the whole page width to spend. `rail` is the 440px inspector: everything
 * single-column, stats in pairs, short labels — the first version reused the
 * full layout there and its viewport-based lg: grids exploded the rail on
 * exactly the screens the rail exists for (breakpoints measure the WINDOW,
 * not the container).
 */
export function ClientDossierPanel({
  d,
  locale,
  windowDays = 90,
  variant = 'full',
}: {
  d: ClientDossier;
  locale: string;
  windowDays?: number;
  variant?: 'full' | 'rail';
}) {
  const rail = variant === 'rail';
  const errRate = d.requests > 0 ? Math.round(((d.badInput + d.serverError) / d.requests) * 100) : 0;
  const topCountry = d.countries[0];
  const attributed = d.countries.reduce((s, c) => s + c.count, 0);
  const quality = qualityTrend(d, new Date());
  const chip = chipOfDossier(d);
  const heat = heatOfDossier(d, new Date());

  return (
    <div className={rail ? 'px-3.5 py-4' : 'border-t border-[var(--ink-4)] bg-[var(--ink-1)]/40 px-4 py-5'}>
      {/* Identity first, in both homes: who this is, their state, and the one
          primary gesture (open the thread) always within reach. */}
      <div className="mb-4 min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-[15px] font-semibold text-[var(--fg-1)]">
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
          {heat.score >= 40 && (
            <span className="shrink-0 text-[12px]" title={heat.parts.map((p) => `${p.label} ${p.points > 0 ? '+' : ''}${p.points}`).join(' · ')}>
              🔥 {heat.score}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="min-w-0 truncate font-mono text-[12.5px] text-[var(--fg-3)]">{d.email}</span>
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
        {d.whatTheyDo && <p className="mt-1 text-[12.5px] italic leading-snug text-[var(--fg-4)]">{d.whatTheyDo}</p>}
        <Link
          href={contactsHref(locale, d.id)}
          className="mt-2 inline-block rounded-md border border-[var(--amber-500)]/40 px-2.5 py-1 text-[12.5px] font-medium text-[var(--amber-400)] hover:bg-[var(--amber-500)]/10"
        >
          ✉ Ouvrir son fil dans Contacts
        </Link>
      </div>

      {/* A blocked customer deserves the cause and the gesture, not just the
          word: the last thing that happened to them was a refusal. */}
      {d.verdict === 'blocked' && (
        <div className="mb-4 rounded-lg border border-red-500/35 bg-red-500/[0.07] px-3 py-2.5">
          <p className="text-[13px] leading-snug text-red-200">
            ⛔ <b>Arrêté sur un refus</b>
            {d.lastRefusalAt ? ` le ${d.lastRefusalAt.slice(0, 10)}` : ''} :{' '}
            {d.authOrQuota > 0 ? `${d.authOrQuota} quota/auth (401/429)` : ''}
            {d.authOrQuota > 0 && d.paywall > 0 ? ' · ' : ''}
            {d.paywall > 0 ? `${d.paywall} paywall (402)` : ''}
            {d.rejectReasons[0] ? ` · motif : ${d.rejectReasons[0].reason}` : ''}.
            Dernier appel servi le {d.lastSuccessAt?.slice(0, 10) ?? '—'}. Tant qu'ils n'ont pas réussi un appel,
            ils croient leur compte fermé.
          </p>
          {d.keys.some((k) => k.plan === 'free') && (
            <p className="mt-1 text-[12px] text-red-300/70" title="La route admin de relèvement arrive ; en attendant, demande-le moi dans le terminal.">
              Relever le quota → demande-le moi.
            </p>
          )}
        </div>
      )}
      {d.verdict === 'struggling' && (
        <div className="mb-4 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2 text-[13px] leading-snug text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn)]">Leur intégration bute</span> — plus de 30 % d'appels
          rejetés. Voir « Ce qui leur est refusé » : souvent un format d'entrée, pas une panne.
        </div>
      )}
      {quality && (quality.thisWeekPct >= 10 || quality.prevWeekPct >= 10) && (
        <p className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[12.5px] leading-snug text-amber-200">
          ⚠ Qualité : <b>{quality.thisWeekPct} %</b> de bad input cette semaine, contre{' '}
          <b>{quality.prevWeekPct} %</b> avant
          {quality.topReason ? <> · motif : <span className="font-mono">{quality.topReason}</span></> : null}
          {quality.thisWeekPct > quality.prevWeekPct + 5
            ? ' — intégration qui régresse, un mail d’aide vaut le coup.'
            : quality.thisWeekPct < quality.prevWeekPct - 5
              ? ' — en amélioration.'
              : ''}
        </p>
      )}

      {/* The figures. In the rail: pairs, short labels, values that truncate
          instead of overflowing. Full keeps the six-across sweep. */}
      <div className={`mb-5 grid gap-2 ${rail ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'}`}>
        <Stat label="Requêtes" value={String(d.requests)} hint={`${d.ok} servies`} />
        <Stat label="Mur payant" value={String(d.paywall + d.authOrQuota)} hint="402 · 401 · 429" />
        <Stat label="Rejets" value={`${errRate} %`} hint={`${d.badInput} en 400`} />
        <Stat label="Latence p95" value={`${d.p95Ms} ms`} hint={`${d.avgMs} ms en moy.`} />
        <Stat label="Machines" value={String(d.distinctIps)} hint="empreintes IP" />
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

      <div className={`grid gap-5 ${rail ? 'grid-cols-1' : 'gap-6 lg:grid-cols-2'}`}>
        <Section title="Activité" note={`${windowDays} derniers jours`}>
          <Sparkbars days={d.days} />
        </Section>

        <Section title="Rythme de la journée" note="heures UTC">
          <HoursStrip hours={d.hours} />
        </Section>

        <Section title="Pays contrôlés" note={attributed > 0 ? `${attributed} rattachés` : undefined}>
          {d.countries.length === 0 ? (
            <Empty>
              Aucun contrôle rattaché. Le rattachement pays↔client existe depuis le 30/07/2026 ; avant cette date
              seules les requêtes isolables ont pu être reconstituées.
            </Empty>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {d.countries.slice(0, rail ? 8 : 14).map((c) => (
                  <span
                    key={c.code}
                    className="rounded border border-[var(--ink-5)] bg-[var(--ink-2)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--fg-2)]"
                    title={`${c.count} contrôles`}
                  >
                    {flag(c.code)} {c.code}
                    <span className="ml-1 text-[var(--fg-5)]">{c.count}</span>
                  </span>
                ))}
                {rail && d.countries.length > 8 && (
                  <span className="px-1 py-0.5 text-[12px] text-[var(--fg-5)]">+{d.countries.length - 8}</span>
                )}
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

        <Section title="Types de requêtes">
          {d.endpoints.length === 0 ? (
            <Empty>Aucun appel enregistré.</Empty>
          ) : (
            d.endpoints.slice(0, rail ? 5 : 8).map((e) => (
              <Bar key={e.path} label={e.path} value={e.count} max={d.endpoints[0].count} />
            ))
          )}
        </Section>

        {!rail && (
          <Section title="Leur pile technique">
            {d.userAgents.length === 0 ? (
              <Empty>Client non identifié.</Empty>
            ) : (
              <div className="space-y-1">
                {d.userAgents.slice(0, 4).map((u) => (
                  <div key={u.ua} className="truncate font-mono text-[12px] text-[var(--fg-3)]" title={u.ua}>
                    {u.ua} <span className="text-[var(--fg-5)]">· {u.count}</span>
                  </div>
                ))}
                {d.clientKinds.length > 0 && (
                  <div className="pt-1 text-[12px] text-[var(--fg-4)]">
                    {d.clientKinds.map((k) => `${k.kind} (${k.count})`).join(' · ')}
                  </div>
                )}
              </div>
            )}
          </Section>
        )}
        {rail && d.userAgents.length > 0 && (
          <Section title="Pile technique">
            <div className="truncate font-mono text-[12px] text-[var(--fg-3)]" title={d.userAgents[0].ua}>
              {d.userAgents[0].ua}
            </div>
            {d.clientKinds.length > 0 && (
              <div className="pt-1 text-[12px] text-[var(--fg-4)]">
                {d.clientKinds.map((k) => `${k.kind} (${k.count})`).join(' · ')}
              </div>
            )}
          </Section>
        )}

        {d.rejectReasons.length > 0 && (
          <Section title="Ce qui leur est refusé">
            {d.rejectReasons.slice(0, rail ? 4 : undefined).map((r) => (
              <Bar key={r.reason} label={r.reason} value={r.count} max={d.rejectReasons[0].count} tone="sky" />
            ))}
          </Section>
        )}

        <Section title="Clés et quota">
          <div className="space-y-2">
            {d.keys.map((k) => {
              const limit = k.creditsTotal ?? k.monthlyLimit ?? 200;
              const used = k.creditsTotal != null ? k.creditsTotal - (k.creditsRemaining ?? 0) : k.usedThisMonth;
              const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
              return (
                <div key={k.prefix} className="rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-[12px] text-[var(--fg-2)]">{k.prefix}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded border border-[var(--ink-5)] px-1 py-px text-[11px] uppercase text-[var(--fg-4)]">
                        {k.plan === 'credits' ? 'crédits' : k.plan === 'paid' ? 'payant' : 'gratuit'}
                      </span>
                      {!k.active && <span className="text-[12px] text-[var(--err)]">révoquée</span>}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--ink-4)]">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? 'var(--err)' : pct >= 80 ? 'var(--warn)' : 'var(--ok)' }}
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
                  {!rail && k.months.length > 1 && (
                    <div className="mt-1 font-mono text-[12px] text-[var(--fg-5)]">
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
            <div className="space-y-1 text-[12.5px] text-[var(--fg-3)]">
              <div>
                <span className="font-mono text-[var(--fg-2)]">{d.mails.sent}</span> envoyé
                {d.mails.sent > 1 ? 's' : ''} ·{' '}
                <span className="font-mono text-[var(--fg-2)]">{d.mails.received}</span> reçu
                {d.mails.received > 1 ? 's' : ''}
              </div>
              {d.mails.lastAt && (
                <div className="min-w-0 truncate">
                  Dernier le <span className="text-[var(--fg-2)]">{d.mails.lastAt.slice(0, 10)}</span>
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
      </div>
    </div>
  );
}
