import type { ReactNode } from 'react';
import { overviewCard } from './overview/section';
import { countryName } from '@/lib/countries';
import { localePath } from '@/lib/locale-path';
import {
  ageText,
  count,
  delta,
  fmt,
  heartbeatText,
  heartbeatsTone,
  machineState,
  publicationDay,
  siteHomeText,
  staleReasonText,
  swissDay,
  swissDayTime,
  unreadText,
  weekSpan,
  type AlertView,
  type BulletinPayload,
  type Tone,
} from '@/lib/dashboard/bulletin';

/**
 * The Monday bulletin (Claude-Alain's approval of 28.09.2026, step A1).
 *
 * A SERVER component, with no state and no JavaScript in the browser: it shows the
 * figures of `GET /v1/admin/bulletin` as they are, in the order of the approved
 * mock-up. Built for a phone first (390 px): one column, tiles two by two, long
 * lists folded in `<details>`. Amber marks the one detail that matters (the keys
 * taken from the home page); green and red only mark states.
 */

const DOT: Record<Tone, string> = {
  ok: 'bg-emerald-400',
  bad: 'bg-red-400',
  neutral: 'bg-[var(--ink-5)]',
};

const PILL: Record<Tone, string> = {
  ok: 'bg-emerald-500/10 text-emerald-300',
  bad: 'bg-red-500/10 text-red-300',
  neutral: 'bg-[var(--ink-4)]/40 text-[var(--fg-3)]',
};

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] ${PILL[tone]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />
      {children}
    </span>
  );
}

function Line({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[12px_minmax(0,1fr)] gap-2.5 border-t border-[var(--ink-4)]/50 py-2.5 first:border-t-0 first:pt-0.5">
      <span aria-hidden className={`mt-1.5 h-2 w-2 rounded-full ${DOT[tone]}`} />
      <div className="min-w-0 text-[13.5px] leading-relaxed text-[var(--fg-2)] [overflow-wrap:anywhere]">{children}</div>
    </li>
  );
}

function Small({ children }: { children: ReactNode }) {
  return <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--fg-4)]">{children}</span>;
}

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-[15px] font-semibold text-[var(--fg-1)]">
      {children}
    </h2>
  );
}

function Unread({ what, plural, reason }: { what: string; plural?: boolean; reason: string }) {
  return (
    <p className="mt-2 rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/40 px-3 py-2 text-[13px] text-[var(--fg-3)]">
      {what} : {plural ? 'non lus' : 'non lu'}, {unreadText(reason)}. Rien n’est affirmé, aucun zéro n’est déduit.
    </p>
  );
}

function Tile({
  value,
  label,
  change,
  note,
}: {
  value: string;
  label: string;
  change?: string | null;
  note?: string | null;
}) {
  return (
    <div className="rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/40 px-3 py-2.5">
      <p className="font-mono text-[26px] leading-tight tabular-nums text-[var(--fg-1)]">
        {value}
        {change && <span className="ml-1.5 align-middle text-[12px] text-[var(--fg-4)]">{change}</span>}
      </p>
      <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--fg-3)]">{label}</p>
      {note && <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--fg-4)]">{note}</p>}
    </div>
  );
}

function countryLabel(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return 'Pays illisible';
  const name = countryName(code, 'fr', code);
  return name === code ? code : `${name} (${code})`;
}

/** An alert by its label or its name, and how many keys it counts when more than one. */
function alertTitle(a: AlertView): string {
  const title = a.label ?? a.name;
  return a.cases > 1 ? `${title} (${a.cases} cas)` : title;
}

function Numbers({ data, locale }: { data: BulletinPayload; locale: string }) {
  const n = data.numbers;
  return (
    <section className={overviewCard} aria-labelledby="bulletin-numbers">
      <SectionTitle id="bulletin-numbers">Les chiffres de la semaine</SectionTitle>
      {n.state !== 'read' ? (
        <Unread what="Les chiffres" plural reason={n.reason} />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Tile
              value={fmt(n.totals.created)}
              label={n.totals.created <= 1 ? 'nouvelle clé' : 'nouvelles clés'}
              change={n.previous ? delta(n.totals.created, n.previous.created) : null}
            />
            <Tile
              value={fmt(n.totals.first_success)}
              label="premier appel réussi"
              change={n.previous ? delta(n.totals.first_success, n.previous.first_success) : null}
            />
            <Tile
              value={fmt(n.totals.paid)}
              label={n.totals.paid <= 1 ? 'clé qui a payé' : 'clés qui ont payé'}
              change={n.previous ? delta(n.totals.paid, n.previous.paid) : null}
            />
            {n.free_active ? (
              <Tile
                value={fmt(n.free_active.people)}
                label="personnes actives en gratuit"
                note={`${count(n.free_active.keys, 'clé', 'clés')}, sur 30 jours ; seuil ${fmt(n.free_active.threshold)}`}
              />
            ) : (
              <Tile
                value="—"
                label="personnes actives en gratuit"
                note="comptées pour la dernière semaine close seulement"
              />
            )}
          </div>
          {n.previous && (
            <p className="mt-2 text-[12px] text-[var(--fg-4)]">
              Écart avec la semaine {n.previous.week.slice(-2).replace(/^0/, '')}.
            </p>
          )}
          <SiteHome home={n.site_home} />
          {n.sentence && <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--fg-2)]">{n.sentence}</p>}
          {n.totals.nudged > 0 && (
            <p className="mt-2 text-[12.5px] text-[var(--fg-3)]">
              {count(n.totals.nudged, 'relance partie', 'relances parties')},{' '}
              {count(n.totals.called_after_nudge, 'suivie', 'suivies')} d’un appel sous sept jours
              {n.totals.followup_pending > 0 ? `, ${fmt(n.totals.followup_pending)} encore dans ce délai` : ''}.
            </p>
          )}
          <p className="mt-3 text-[13px]">
            <a className="text-amber-300 underline-offset-2 hover:underline" href={localePath(locale, '/dashboard/portes')}>
              Le tableau des portes, semaine par semaine
            </a>
          </p>
        </>
      )}
    </section>
  );
}

function SiteHome({ home }: { home: Extract<BulletinPayload['numbers'], { state: 'read' }>['site_home'] }) {
  const text = siteHomeText(home);
  return (
    <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--fg-2)]">
      {text.figure ? (
        <>
          Dont <b className="font-semibold text-amber-300">{text.figure}</b> : la mesure de l’accueil neuf.
        </>
      ) : null}
      {text.note && <Small>{text.note}</Small>}
    </p>
  );
}

function Moved({ data }: { data: BulletinPayload }) {
  const { merged_pulls: pulls, heartbeats: beats, alerts, sources } = data.moved;
  return (
    <section className={overviewCard} aria-labelledby="bulletin-moved">
      <SectionTitle id="bulletin-moved">Ce qui a bougé</SectionTitle>
      <ul className="mt-3">
        {pulls.state === 'read' ? (
          <Line tone={pulls.pulls.length > 0 ? 'ok' : 'neutral'}>
            {pulls.pulls.length === 0
              ? 'Aucune PR fusionnée dans main cette semaine.'
              : `${count(pulls.pulls.length, 'PR fusionnée', 'PR fusionnées')} dans main, donc mise${pulls.pulls.length > 1 ? 's' : ''} en ligne.`}
            {pulls.pulls.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[12.5px] text-[var(--fg-4)]">Voir la liste</summary>
                <ul className="mt-1.5 space-y-1.5">
                  {pulls.pulls.map((p) => (
                    <li key={p.number} className="text-[12.5px] leading-snug text-[var(--fg-3)]">
                      <a className="text-[var(--fg-2)] underline-offset-2 hover:underline" href={p.url} target="_blank" rel="noreferrer">
                        #{p.number}
                      </a>{' '}
                      {p.title} <span className="text-[var(--fg-4)]">· {swissDay(p.merged_at)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <Small>Lu sur GitHub le {swissDayTime(pulls.fetched_at)}.</Small>
          </Line>
        ) : (
          <Line tone="neutral">
            Mises en ligne : non lues, {unreadText(pulls.reason)}. Rien n’est affirmé.
            <Small>Essai du {swissDayTime(pulls.fetched_at)} ; nouvel essai dans dix minutes au plus tôt.</Small>
          </Line>
        )}

        {beats.state === 'read' ? (
          <Line tone={heartbeatsTone(beats)}>
            Automatisations à l’heure : {fmt(beats.on_time)} sur {fmt(beats.items.length)}.
            {beats.items
              .filter((i) => i.state === 'late' || i.state === 'unreadable')
              .map((i) => (
                <Small key={i.name}>
                  {i.label} : {heartbeatText(i)}
                </Small>
              ))}
            {beats.never > 0 && (
              <Small>
                Sans battement encore :{' '}
                {beats.items
                  .filter((i) => i.state === 'never')
                  .map((i) => i.label)
                  .join(', ')}
                .
              </Small>
            )}
            <Small>
              Pour un relevé lancé par GitHub, le premier battement enregistré peut être le début de la surveillance, pas
              une exécution.
            </Small>
            <details className="mt-1">
              <summary className="cursor-pointer text-[12.5px] text-[var(--fg-4)]">Toutes les automatisations</summary>
              <ul className="mt-1.5 space-y-1">
                {beats.items.map((i) => (
                  <li key={i.name} className="text-[12.5px] leading-snug text-[var(--fg-3)]">
                    {i.label} : {heartbeatText(i)}
                  </li>
                ))}
              </ul>
            </details>
          </Line>
        ) : (
          <Line tone="neutral">Signes de vie : non lus, {unreadText(beats.reason)}.</Line>
        )}

        {alerts.state === 'read' ? (
          <Line tone={alerts.open.length > 0 ? 'bad' : 'ok'}>
            {alerts.open.length === 0
              ? 'Aucune alerte ouverte en ce moment.'
              : `${count(alerts.open.length, 'alerte ouverte', 'alertes ouvertes')} en ce moment.`}
            {alerts.open.map((a) => (
              <Small key={a.name}>
                {alertTitle(a)}
                {a.opened_at ? `, ouverte le ${swissDayTime(a.opened_at)}` : ''}
                {a.last_failure_at ? `, dernier échec vu le ${swissDayTime(a.last_failure_at)}` : ''}
              </Small>
            ))}
            {alerts.failing.length > 0 && (
              <Small>En échec sans message parti : {alerts.failing.map(alertTitle).join(', ')}.</Small>
            )}
            {alerts.stale.length > 0 && (
              <Small>
                Sans nouvel échec depuis plus de 7 jours, jamais refermées :{' '}
                {alerts.stale
                  .map((a) =>
                    a.last_failure_at ? `${alertTitle(a)}, dernier échec le ${swissDay(a.last_failure_at)}` : alertTitle(a),
                  )
                  .join(' ; ')}
                .
              </Small>
            )}
          </Line>
        ) : (
          <Line tone="neutral">Alertes : non lues, {unreadText(alerts.reason)}.</Line>
        )}

        {sources.state === 'read' ? (
          <Line
            tone={
              // Red only for a relevé that stopped; a source its publisher froze is a
              // known property of that source, not a failure to act on.
              sources.sources.some((s) => s.stale_reason === 'import_overdue')
                ? 'bad'
                : sources.fresh < sources.total
                  ? 'neutral'
                  : 'ok'
            }
          >
            Sources de l’annuaire BIC à jour : {fmt(sources.fresh)} sur {fmt(sources.total)}.
            {sources.sources
              .filter((s) => s.stale)
              .map((s) => (
                <Small key={s.source}>
                  {s.source} : {staleReasonText(s.stale_reason)}
                  {s.stale_reason === 'source_frozen' && s.source_as_of ? ` (données de ${s.source_as_of})` : ''}
                  {s.stale_reason === 'import_overdue' && s.age_days !== null ? ` (relevé ${ageText(s.age_days * 24)})` : ''}
                </Small>
              ))}
          </Line>
        ) : (
          <Line tone="neutral">Sources : non lues, {unreadText(sources.reason)}.</Line>
        )}
      </ul>
      <p className="mt-3 text-[12px] leading-snug text-[var(--fg-4)]">
        Signes de vie, alertes et sources : l’état relevé le {data.observed_at_zurich}, pas celui de la semaine.
      </p>
    </section>
  );
}

function Needs({ data, locale }: { data: BulletinPayload; locale: string }) {
  const { missing_bics: bics, forum_threads: forum } = data.needs;
  return (
    <section className={overviewCard} aria-labelledby="bulletin-needs">
      <SectionTitle id="bulletin-needs">Ce qu’on cherche sans trouver</SectionTitle>
      <ul className="mt-3">
        {bics.state === 'read' ? (
          bics.total_lookups === 0 ? (
            <Line tone="neutral">Aucune recherche de BIC sans réponse cette semaine.</Line>
          ) : (
            <>
              {bics.top.map((c) => (
                <Line key={c.country} tone="neutral">
                  {countryLabel(c.country)} : {count(c.lookups, 'recherche', 'recherches')} de BIC sans réponse
                  <Small>{count(c.distinct_codes, 'code différent', 'codes différents')}</Small>
                </Line>
              ))}
              <li className="pt-1 text-[12px] text-[var(--fg-4)]">
                En tout {count(bics.total_lookups, 'recherche', 'recherches')} sans réponse, sur{' '}
                {count(bics.total_countries, 'pays', 'pays')}.
                {bics.excluded_internal > 0 ? ' Nos propres clés de test et de sonde sont écartées.' : ''}
              </li>
            </>
          )
        ) : (
          <Line tone="neutral">BIC introuvables : non lus, {unreadText(bics.reason)}.</Line>
        )}
        {forum.state === 'read' ? (
          <Line tone="neutral">
            {forum.found === 0
              ? 'Aucun fil nouveau dans le radar des forums.'
              : `${count(forum.found, 'fil trouvé', 'fils trouvés')} par le radar des forums, dont ${fmt(forum.still_new)} pas encore ${forum.still_new <= 1 ? 'regardé' : 'regardés'}.`}
            <Small>
              <a className="text-[var(--fg-3)] underline-offset-2 hover:underline" href={localePath(locale, '/dashboard/forums')}>
                Ouvrir les forums
              </a>
            </Small>
          </Line>
        ) : (
          <Line tone="neutral">Forums : non lus, {unreadText(forum.reason)}.</Line>
        )}
      </ul>
    </section>
  );
}

function NotYet({ data }: { data: BulletinPayload }) {
  if (data.not_yet.length === 0) return null;
  return (
    <section className={overviewCard} aria-labelledby="bulletin-not-yet">
      <SectionTitle id="bulletin-not-yet">Pas encore là</SectionTitle>
      <p className="mt-1 text-[12.5px] text-[var(--fg-4)]">
        Ces blocs de la maquette n’ont pas encore de données : la page le dit plutôt que de les montrer vides.
      </p>
      <ul className="mt-2 space-y-2">
        {data.not_yet.map((b) => (
          <li key={b.key} className="text-[13px] leading-snug text-[var(--fg-2)]">
            <span className="font-medium text-[var(--fg-1)]">{b.title}</span>
            <Small>{b.reason}</Small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function weekNumber(label: string): string {
  return label.slice(-2).replace(/^0/, '');
}

export function BulletinView({ data, locale }: { data: BulletinPayload; locale: string }) {
  const state = machineState(data);
  const pulls = data.moved.merged_pulls;
  const base = localePath(locale, '/dashboard/bulletin');
  const fellBack = !!data.requested.week && data.requested.week !== data.week.label;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className={overviewCard} aria-labelledby="bulletin-cover">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--fg-4)]">
          Semaine {weekNumber(data.week.label)} · {weekSpan(data.week.monday, data.week.sunday)}
        </p>
        <p
          id="bulletin-cover"
          className="mt-1.5 font-[family-name:var(--font-bebas)] text-[40px] uppercase leading-[0.95] text-[var(--fg-1)]"
          style={{ letterSpacing: '0.01em' }}
        >
          {publicationDay(data.week.sunday)}
        </p>
        {!data.week.last_complete && (
          <p className="mt-1.5 text-[12.5px] text-[var(--fg-4)]">Un bulletin passé : ce n’est pas celui de ce lundi.</p>
        )}
        {fellBack && (
          <p className="mt-1.5 text-[12.5px] text-[var(--fg-4)]">
            La semaine demandée ({data.requested.week}) n’est pas une semaine close du tableau des portes : voici la
            dernière semaine close.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Pill tone={state.tone}>{state.text}</Pill>
          <Pill tone="neutral">
            {pulls.state === 'read'
              ? count(pulls.pulls.length, 'mise en ligne', 'mises en ligne')
              : 'Mises en ligne non lues'}
          </Pill>
        </div>
      </section>

      <Numbers data={data} locale={locale} />
      <Moved data={data} />
      <Needs data={data} locale={locale} />
      <NotYet data={data} />

      <nav aria-label="Autres semaines" className="flex items-center justify-between gap-3 text-[13px]">
        {data.week.previous ? (
          <a className="text-[var(--fg-3)] underline-offset-2 hover:underline" href={`${base}?week=${data.week.previous}`}>
            ← Semaine {weekNumber(data.week.previous)}
          </a>
        ) : (
          <span />
        )}
        {data.week.next ? (
          <a className="text-[var(--fg-3)] underline-offset-2 hover:underline" href={`${base}?week=${data.week.next}`}>
            Semaine {weekNumber(data.week.next)} →
          </a>
        ) : (
          <span />
        )}
      </nav>

      <details className="text-[12.5px] text-[var(--fg-4)]">
        <summary className="cursor-pointer">D’où vient chaque ligne</summary>
        <ul className="mt-2 space-y-1.5 leading-relaxed text-[var(--fg-3)]">
          {Object.entries(data.definitions).map(([k, v]) => (
            <li key={k}>{v}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
