import { FeedbackDoneButton } from './feedback-done-button';

/**
 * « L'outil vivant » — the three loops through which usage teaches the tool,
 * so their existence is a fact the operator SEES rather than a property of the
 * codebase.
 *
 * Reads three instruments added 01/09/2026 (see src/lib/demand-gaps.ts for
 * the doctrine): the demand ledger (what was asked that we could not answer,
 * ranked), the agent-feedback reader (send_feedback finally has the human the
 * promise names), and per-source freshness (each register answers for its own
 * age). The card is deliberately quiet when all is well — one green line per
 * healthy loop — because its job on a calm day is to prove the loops exist,
 * and on a bad day to name the register, the country or the report that needs
 * a decision.
 *
 * ⚠️ ENS-04, corrected 2026-09-01: two of the three loops used to render a
 * REASSURING GREEN when their reader fell over. `gaps === null` printed
 * "nothing, no valid request found a closed door" and `feedbackOpen ?? 0`
 * printed "no open report" — in emerald, on a rotated token. The card built to
 * enforce "never build an instrument without wiring its reader" was reproducing
 * the exact failure it denounces. Each loop now takes the HTTP status of its
 * failed read and says so, and a failed read is never green.
 *
 * The `loops` prop exists because the cockpit rebuild of the same day splits
 * the card in two: freshness belongs with "what is broken", demand and
 * feedback belong with "what is new". Default is all three, so no caller has
 * to know about the split.
 *
 * Server component, French like the rest of the dashboard; the only client
 * island is the « traité » button on each report.
 */

export interface DemandGapEntry {
  kind: string;
  country: string | null;
  code: string;
  outcome: string;
  hits: number;
  last_seen: string;
}

/** The monthly proposal the ledger makes (src/lib/demand-proposal.ts). */
export interface DemandProposal {
  month: string;
  kind: 'register' | 'composite' | 'none' | 'too_early';
  country: string | null;
  code: string;
  codes: number;
  hits: number;
  share_pct: number;
  action_fr: string;
  why_fr: string;
  source_hint: string | null;
}

export interface DemandGapsPayload {
  by_country: Array<{ country: string | null; distinct_codes: number; hits: number }>;
  top: DemandGapEntry[];
  outages: DemandGapEntry[];
  /** Live proposal for the window shown; absent on an older API. */
  proposal?: DemandProposal | null;
  /** The last monthly turn: what was proposed on the 1st, and whether it was sent. */
  monthly?: { month: string; proposed_at: string; sent: boolean; proposal: DemandProposal | null } | null;
}

export interface FeedbackReport {
  id: number;
  created_at: string;
  endpoint: string | null;
  error_type: string;
  notes: string | null;
  agent: string | null;
  status: string;
}

export interface SourceFreshnessEntry {
  source: string;
  entries: number;
  last_updated: string | null;
  stale: boolean;
}

export type LivingLoop = 'demand' | 'feedback' | 'freshness';

const ALL_LOOPS: LivingLoop[] = ['demand', 'feedback', 'freshness'];

const ERROR_TYPE_FR: Record<string, string> = {
  wrong_validation: 'validation contestée',
  stale_bic: 'BIC périmé',
  missing_data: 'donnée manquante',
  incorrect_classification: 'classification contestée',
  latency: 'lenteur',
  other: 'autre',
};

/**
 * What a loop says when its reader failed. Grey and explicit, never green and
 * never a zero: "we did not manage to look" and "there is nothing" are two
 * different pieces of news, and only one of them is good.
 */
function ReaderDown({ status }: { status: number }) {
  return (
    <p className="mt-1.5 text-[12px] text-amber-300">
      lecteur en échec {status === 0 ? '(API injoignable)' : `(HTTP ${status})`} — cette boucle n’affiche pas
      « rien », elle n’a pas pu être lue.
    </p>
  );
}

function LoopTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-4)]">{children}</p>
  );
}

export function LivingToolCard({
  gaps,
  feedbackOpen,
  reports,
  sources,
  gapsFailed = null,
  feedbackFailed = null,
  sourcesFailed = null,
  loops = ALL_LOOPS,
  bare = false,
}: {
  gaps: DemandGapsPayload | null;
  feedbackOpen: number;
  reports: FeedbackReport[];
  sources: SourceFreshnessEntry[];
  /** HTTP status of the demand read when it failed; null when it succeeded. */
  gapsFailed?: number | null;
  /** HTTP status of the feedback read when it failed; null when it succeeded. */
  feedbackFailed?: number | null;
  /** HTTP status of /health when it failed; null when it succeeded. */
  sourcesFailed?: number | null;
  /** Which loops to render. Default: all three. */
  loops?: LivingLoop[];
  /** Drop the card chrome and the 🌱 heading, to sit inside another block. */
  bare?: boolean;
}) {
  const staleSources = sources.filter((s) => s.stale);
  const topCountries = gaps?.by_country.slice(0, 5) ?? [];
  const topCodes = gaps?.top.slice(0, 5) ?? [];
  const openReports = reports.filter((r) => r.status === 'open').slice(0, 3);
  const shown = ALL_LOOPS.filter((l) => loops.includes(l));

  const body = (
    <div
      className={`grid grid-cols-1 gap-4 ${bare ? '' : 'mt-3'} ${
        shown.length >= 3 ? 'lg:grid-cols-3' : shown.length === 2 ? 'lg:grid-cols-2' : ''
      }`}
    >
      {shown.includes('demand') && (
        <div className="min-w-0">
          <LoopTitle>Demande insatisfaite · 30 j</LoopTitle>
          {gapsFailed !== null ? (
            <ReaderDown status={gapsFailed} />
          ) : topCountries.length === 0 ? (
            <p className="mt-1.5 text-[12px] text-emerald-400">
              Rien — aucune demande valide n’a trouvé porte close.
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-[12px] text-[var(--fg-3)]">
                {topCountries.map((c, i) => (
                  <span key={c.country ?? i}>
                    {i > 0 && ' · '}
                    <b className="text-[var(--fg-2)]">{c.country}</b> {c.hits}×
                  </span>
                ))}
              </p>
              <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-[var(--fg-4)]">
                {topCodes.map((g) => (
                  <li key={`${g.kind}:${g.country}:${g.code}:${g.outcome}`} className="truncate">
                    <span className="font-mono text-[var(--fg-3)]">
                      {g.country} {g.code}
                    </span>{' '}
                    · {g.hits}× · {g.outcome.split(':')[0].replace(/_/g, ' ')}
                  </li>
                ))}
              </ul>
            </>
          )}
          {gaps && gaps.outages.length > 0 && (
            <p className="mt-1.5 text-[11px] text-amber-400">
              + {gaps.outages.length} clé{gaps.outages.length > 1 ? 's' : ''} en panne de lecture
              (unavailable), comptée{gaps.outages.length > 1 ? 's' : ''} à part
            </p>
          )}
          {gaps?.proposal && (
            <p
              className={`mt-2 text-[11px] leading-snug ${
                gaps.proposal.kind === 'register' || gaps.proposal.kind === 'composite'
                  ? 'text-[var(--fg-2)]'
                  : 'text-[var(--fg-4)]'
              }`}
              title={gaps.proposal.why_fr}
            >
              <b>Proposition du mois</b> ({gaps.proposal.month}) : {gaps.proposal.action_fr}
              {gaps.monthly?.sent ? ' Envoyée sur Telegram.' : ''}
            </p>
          )}
        </div>
      )}

      {shown.includes('feedback') && (
        <div className="min-w-0">
          <LoopTitle>Feedback des agents</LoopTitle>
          {feedbackFailed !== null ? (
            <ReaderDown status={feedbackFailed} />
          ) : feedbackOpen === 0 ? (
            <p className="mt-1.5 text-[12px] text-emerald-400">Aucun rapport ouvert.</p>
          ) : (
            <>
              <p className="mt-1.5 text-[12px] text-[var(--fg-3)]">
                <b className="text-amber-400">{feedbackOpen}</b> rapport{feedbackOpen > 1 ? 's' : ''} ouvert
                {feedbackOpen > 1 ? 's' : ''}
              </p>
              <ul className="mt-1.5 flex flex-col gap-1 text-[11px] text-[var(--fg-4)]">
                {openReports.map((r) => (
                  <li key={r.id} className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="text-[var(--fg-3)]">
                        {ERROR_TYPE_FR[r.error_type] ?? r.error_type}
                      </span>
                      {r.endpoint ? ` · ${r.endpoint}` : ''} · {r.created_at.slice(0, 10)}
                      {r.notes ? (
                        <span className="block truncate text-[var(--fg-4)]">{r.notes}</span>
                      ) : null}
                    </span>
                    <FeedbackDoneButton id={r.id} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {shown.includes('freshness') && (
        <div className="min-w-0">
          <LoopTitle>Fraîcheur des registres</LoopTitle>
          {sourcesFailed !== null ? (
            <ReaderDown status={sourcesFailed} />
          ) : sources.length === 0 ? (
            <p className="mt-1.5 text-[12px] text-[var(--fg-4)]">indisponible</p>
          ) : staleSources.length === 0 ? (
            <p className="mt-1.5 text-[12px] text-emerald-400">
              {sources.length} sources, toutes fraîches — dernier rebuild{' '}
              {(sources[0]?.last_updated ?? '').slice(0, 10) || '—'}
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-0.5 text-[12px]">
              {staleSources.map((s) => (
                <li key={s.source} className="text-red-400">
                  ⚠ <b>{s.source}</b> n’a pas été rafraîchie depuis{' '}
                  {(s.last_updated ?? 'jamais').slice(0, 10)}
                </li>
              ))}
              <li className="text-[11px] text-[var(--fg-4)]">
                {sources.length - staleSources.length} autres sources fraîches
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );

  if (bare) return body;

  return (
    <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-[var(--fg-2)]">🌱 L’outil vivant</h2>
        <p className="text-[11px] text-[var(--fg-4)]">
          les boucles par lesquelles l’usage améliore l’outil
        </p>
      </div>
      {body}
    </div>
  );
}
