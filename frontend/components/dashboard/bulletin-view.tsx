import type { ReactNode } from 'react';
import { overviewCard } from './overview/section';
import { countryName } from '@/lib/countries';
import { localePath } from '@/lib/locale-path';
import {
  ANSWERS,
  ageText,
  answerWord,
  costReasonText,
  count,
  delta,
  durationText,
  fmt,
  moneyList,
  natureText,
  periodTitle,
  receivedReasonText,
  heartbeatText,
  heartbeatsTone,
  machineState,
  publicationDay,
  scoreText,
  siteHomeText,
  staleReasonText,
  swissDay,
  swissDayTime,
  unreadText,
  weekSpan,
  type AlertView,
  type BulletinAlertHistory,
  type BulletinPayload,
  type MoneyPeriod,
  type ProposalView,
  type Tone,
} from '@/lib/dashboard/bulletin';

/** Where the answer buttons post: the site's own route, which keeps the admin secret. */
export const ANSWER_ROUTE = '/api/dashboard/bulletin-answer';

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

        {data.moved.alert_history && <AlertHistoryLine history={data.moved.alert_history} />}

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
        Signes de vie, alertes ouvertes et sources : l’état relevé le {data.observed_at_zurich}, pas celui de la
        semaine.{data.moved.alert_history ? ' L’historique des alertes, lui, est celui de la semaine.' : ''}
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

function groupTitle(g: { name: string; label: string | null; cases: number }): string {
  const title = g.label ?? g.name;
  return g.cases > 1 ? `${title} (${g.cases} fois)` : title;
}

/** The week's alert history (step A2): opened and closed DURING the week, never "overlapping". */
function AlertHistoryLine({ history }: { history: BulletinAlertHistory | { state: 'unread'; reason: string } }) {
  if (history.state !== 'read') {
    return <Line tone="neutral">Historique des alertes : non lu, {unreadText(history.reason)}.</Line>;
  }
  if (history.coverage === 'none') {
    return (
      <Line tone="neutral">
        Historique des alertes : pas encore tenu cette semaine-là.
        {history.kept_since && <Small>Il est tenu depuis le {swissDayTime(history.kept_since)}.</Small>}
      </Line>
    );
  }
  const opened = history.opened.reduce((n, g) => n + g.cases, 0);
  const closed = history.closed.reduce((n, g) => n + g.cases, 0);
  return (
    <Line tone={opened > 0 ? 'bad' : 'neutral'}>
      {opened === 0 && closed === 0
        ? 'Aucune alerte ouverte ni refermée pendant la semaine.'
        : `Pendant la semaine : ${count(opened, 'alerte ouverte', 'alertes ouvertes')}, ${count(closed, 'refermée', 'refermées')}.`}
      {history.opened.map((g) => (
        <Small key={`o-${g.name}`}>
          Ouverte : {groupTitle(g)}, le {swissDayTime(g.first_opened_at)}
          {g.still_open > 0 ? (g.still_open === g.cases ? ', toujours ouverte' : `, ${fmt(g.still_open)} toujours ouverte${g.still_open > 1 ? 's' : ''}`) : ''}
        </Small>
      ))}
      {history.closed.map((g) => (
        <Small key={`c-${g.name}`}>
          Refermée : {groupTitle(g)}, le {swissDayTime(g.last_closed_at)}
          {g.longest_hours !== null ? `, après ${durationText(g.longest_hours)}` : ''}
          {g.opened_before_history > 0 ? ' (ouverte avant que l’historique soit tenu)' : ''}
        </Small>
      ))}
      {history.coverage === 'partial' && history.kept_since && (
        <Small>Historique tenu seulement depuis le {swissDayTime(history.kept_since)} : le début de la semaine manque.</Small>
      )}
    </Line>
  );
}

function proposalTitle(p: ProposalView): string {
  if (p.kind === 'bic_introuvable' && p.country) {
    return `Chercher une source pour les BIC : ${countryLabel(p.country)}`;
  }
  return p.title;
}

const ANSWER_BUTTON: Record<'chosen' | 'idle', string> = {
  chosen: 'border-amber-300/70 bg-amber-300/15 text-amber-200',
  idle: 'border-[var(--ink-4)] bg-[var(--ink-1)]/40 text-[var(--fg-2)] hover:border-[var(--fg-4)]',
};

/**
 * A plain HTML form per proposal: no JavaScript in the browser (WebKit renders it as
 * is), the site route checks the session, forwards to the API with the secret and
 * comes back here with a 303.
 */
function AnswerForm({ p, locale }: { p: ProposalView; locale: string }) {
  return (
    <form method="post" action={ANSWER_ROUTE} className="mt-2 flex flex-wrap gap-1.5">
      <input type="hidden" name="key" value={p.key} />
      <input type="hidden" name="locale" value={locale} />
      {ANSWERS.map((a) => {
        const chosen = p.answer?.answer === a;
        return (
          <button
            key={a}
            type="submit"
            name="answer"
            value={a}
            aria-pressed={chosen}
            className={`min-h-[36px] rounded-full border px-3.5 text-[13px] ${ANSWER_BUTTON[chosen ? 'chosen' : 'idle']}`}
          >
            {answerWord(a)}
          </button>
        );
      })}
    </form>
  );
}

function Decisions({ data, locale, notice }: { data: BulletinPayload; locale: string; notice: AnswerNotice }) {
  const d = data.decisions;
  if (!d) return null;
  return (
    <section className={overviewCard} aria-labelledby="bulletin-decisions" id="decisions">
      <SectionTitle id="bulletin-decisions">À toi de décider</SectionTitle>
      {notice && (
        <p
          role="status"
          className={`mt-2 rounded-lg px-3 py-2 text-[13px] ${notice === 'ok' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}
        >
          {notice === 'ok'
            ? 'Réponse enregistrée.'
            : 'La réponse n’a pas été enregistrée : la proposition n’est peut-être plus affichée, ou l’API n’a pas répondu.'}
        </p>
      )}
      {d.state !== 'read' ? (
        <Unread what="Les propositions" plural reason={d.reason} />
      ) : !d.computed ? (
        d.answered.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--fg-3)]">Aucune réponse donnée au bulletin de cette semaine-là.</p>
        ) : (
          <ul className="mt-3">
            {d.answered.map((a) => (
              <Line key={a.key} tone="neutral">
                {a.label}
                <Small>
                  Réponse : {answerWord(a.answer)}, le {swissDayTime(a.answered_at)}.
                </Small>
              </Line>
            ))}
          </ul>
        )
      ) : d.shown.length === 0 ? (
        <p className="mt-2 text-[13px] text-[var(--fg-3)]">Rien à décider cette semaine.</p>
      ) : (
        <ul className="mt-3">
          {d.shown.map((p) => (
            <Line key={p.key} tone={p.answer ? 'ok' : 'neutral'}>
              <span className="font-medium text-[var(--fg-1)]">{proposalTitle(p)}</span>
              {p.detail && <Small>{p.detail}</Small>}
              {p.postponed_at && <Small>Revenue : reportée le {swissDay(p.postponed_at)}.</Small>}
              {p.answer && (
                <Small>
                  Ta réponse : {answerWord(p.answer.answer)}, le {swissDayTime(p.answer.answered_at)}. Tu peux la changer.
                </Small>
              )}
              <AnswerForm p={p} locale={locale} />
            </Line>
          ))}
        </ul>
      )}
      {d.state === 'read' && d.computed && d.more > 0 && (
        <p className="mt-2 text-[12.5px] text-[var(--fg-4)]">
          {count(d.more, 'autre proposition attend', 'autres propositions attendent')} : elle
          {d.more > 1 ? 's viendront' : ' viendra'} quand une place se libère.
        </p>
      )}
      <p className="mt-2 text-[12px] leading-snug text-[var(--fg-4)]">
        Oui et Non ne reviennent pas ; Plus tard revient dans quatre semaines.
      </p>
    </section>
  );
}

const RESULT_WORD: Record<MoneyPeriod['result']['status'], string> = {
  exact: 'Résultat',
  estime: 'Résultat estimé',
  au_plus: 'Au plus',
  inconnu: 'Résultat inconnu',
};

function MoneyPeriodBlock({ p }: { p: MoneyPeriod }) {
  const r = p.result;
  const tone: Tone = r.status === 'inconnu' ? 'neutral' : r.status === 'au_plus' ? 'neutral' : 'ok';
  return (
    <li className="border-t border-[var(--ink-4)]/50 py-3 first:border-t-0 first:pt-1">
      <p className="text-[13.5px] font-medium text-[var(--fg-1)]">{periodTitle(p)}</p>
      <dl className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-[var(--fg-3)]">Encaissé</dt>
        <dd className="text-right font-mono tabular-nums text-[var(--fg-1)] [overflow-wrap:anywhere]">
          {p.received.state === 'read' ? moneyList(p.received.gross) : 'inconnu'}
        </dd>
        {p.received.state === 'read' && Object.keys(p.received.refunded).length > 0 && (
          <>
            <dt className="text-[var(--fg-3)]">Remboursé</dt>
            <dd className="text-right font-mono tabular-nums text-[var(--fg-2)]">
              {moneyList(Object.fromEntries(Object.entries(p.received.refunded).map(([c, v]) => [c, -v])))}
            </dd>
          </>
        )}
        {p.costs.map((c) => (
          <CostRow key={c.item} line={c} />
        ))}
      </dl>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-[var(--ink-4)]/40 pt-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--fg-2)]">
          <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[tone]}`} />
          {RESULT_WORD[r.status]}
        </span>
        <span className="font-mono text-[15px] tabular-nums text-[var(--fg-1)] [overflow-wrap:anywhere]">
          {r.by_currency ? moneyList(r.by_currency, true) : '—'}
        </span>
      </div>
      {p.received.state !== 'read' && <Small>Encaissé inconnu : {receivedReasonText(p.received.reason)}.</Small>}
      {p.received.state === 'read' && p.received.test_mode && <Small>Clé Stripe de test : montants fictifs.</Small>}
      {r.status === 'au_plus' && r.missing.length > 0 && (
        <Small>
          Il manque : {r.missing.join(', ')}. Ces coûts ne peuvent que faire baisser le résultat.
        </Small>
      )}
      {r.status === 'estime' && <Small>Au moins un coût est une estimation.</Small>}
      {!p.complete && <Small>Mois en cours, lu jusqu’au dimanche de la semaine.</Small>}
    </li>
  );
}

function CostRow({ line }: { line: MoneyPeriod['costs'][number] }) {
  if (line.state === 'connu') {
    const zero = Object.values(line.amounts).every((v) => v === 0);
    return (
      <>
        <dt className="text-[var(--fg-3)]">
          {line.label} <span className="text-[11.5px] text-[var(--fg-4)]">({natureText(line.nature)})</span>
        </dt>
        <dd className="text-right font-mono tabular-nums text-[var(--fg-2)] [overflow-wrap:anywhere]">
          {zero
            ? moneyList(line.amounts, true)
            : moneyList(Object.fromEntries(Object.entries(line.amounts).map(([c, v]) => [c, -v])))}
        </dd>
      </>
    );
  }
  // A punctual cost nobody entered is not counted, and does not cap the result.
  if (!line.blocking && line.reason === 'non_saisi') return null;
  return (
    <>
      <dt className="text-[var(--fg-3)]">{line.label}</dt>
      <dd className="text-right text-[12.5px] text-[var(--fg-4)]">inconnu, {costReasonText(line.reason)}</dd>
    </>
  );
}

function Money({ data }: { data: BulletinPayload }) {
  const m = data.money;
  if (!m) return null;
  return (
    <section className={overviewCard} aria-labelledby="bulletin-money">
      <SectionTitle id="bulletin-money">Encaissé moins coûts</SectionTitle>
      {m.state !== 'read' ? (
        <Unread what="L’argent" reason={m.reason} />
      ) : (
        <>
          <ul className="mt-2">
            {m.periods.map((p) => (
              <MoneyPeriodBlock key={p.month} p={p} />
            ))}
          </ul>
          <p className="mt-1 text-[12px] leading-snug text-[var(--fg-4)]">
            Chaque devise reste la sienne, rien n’est converti. Un coût non saisi pour toute la période est inconnu,
            jamais compté pour zéro.{m.stripe_read_at ? ` Stripe lu le ${swissDayTime(m.stripe_read_at)}.` : ''}
          </p>
        </>
      )}
    </section>
  );
}

function Veille({ data }: { data: BulletinPayload }) {
  const v = data.veille;
  if (!v) return null;
  return (
    <section className={overviewCard} aria-labelledby="bulletin-veille">
      <SectionTitle id="bulletin-veille">La veille et le score des IA</SectionTitle>
      {v.state !== 'read' ? (
        <Unread what="La veille" reason={v.reason} />
      ) : (
        <ul className="mt-3">
          {v.sources.map((s) =>
            s.state === 'read' ? (
              <Line key={s.source} tone="neutral">
                <span className="font-medium text-[var(--fg-1)]">{s.label}</span>
                {s.score && (
                  <p className="mt-1 font-mono text-[22px] leading-tight tabular-nums text-[var(--fg-1)]">
                    {fmt(s.score.value)}
                    <span className="text-[14px] text-[var(--fg-4)]"> / {fmt(s.score.out_of)}</span>
                  </p>
                )}
                {s.score && <Small>{scoreText(s.score)} où une recherche web fait apparaître IBANforge.</Small>}
                <ul className="mt-1 space-y-1">
                  {s.lines.map((line, i) => (
                    <li key={i} className="text-[13px] leading-snug text-[var(--fg-2)]">
                      {line}
                    </li>
                  ))}
                </ul>
                <Small>Déposé le {swissDayTime(s.received_at)}.</Small>
              </Line>
            ) : (
              <Line key={s.source} tone="neutral">
                <span className="font-medium text-[var(--fg-1)]">{s.label}</span>
                <Small>Rien de déposé pour cette semaine.</Small>
              </Line>
            ),
          )}
        </ul>
      )}
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

/** What the answer route said, read back from the address after its 303. */
export type AnswerNotice = 'ok' | 'echec' | null;

export function BulletinView({
  data,
  locale,
  notice = null,
}: {
  data: BulletinPayload;
  locale: string;
  notice?: AnswerNotice;
}) {
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

      <Decisions data={data} locale={locale} notice={notice} />
      <Numbers data={data} locale={locale} />
      <Money data={data} />
      <Moved data={data} />
      <Needs data={data} locale={locale} />
      <Veille data={data} />
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
