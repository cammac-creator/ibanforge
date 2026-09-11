import { getTranslations } from 'next-intl/server';
import { CreditCard, RotateCcw, TriangleAlert } from 'lucide-react';
import { formatGrouped } from '@/lib/format-grouped';
import { attemptDay, declineKey, retainedFailedPayments } from '@/lib/dashboard/failed-payments';
import { overviewCard } from './section';

/**
 * Les paiements refusés, montrés parce que personne ne les voyait.
 *
 * Un refus est le signal commercial le plus actionnable de cet écran : une
 * personne a sorti sa carte et elle est repartie sans rien. Deux précautions
 * qui font toute la valeur de la carte :
 *
 *  - **Un refus rattrapé n'est pas une vente perdue.** L'acheteur d'août a payé
 *    au troisième essai ; l'annoncer comme perdu aurait été faux.
 *  - **Indisponible n'est jamais zéro.** Sans cette règle, une lecture ratée
 *    dirait « aucun refus », ce qui est la plus rassurante des erreurs.
 */
export async function FailedPaymentsCard({ value, locale }: { value: unknown; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'dashboard.overview' });
  const data = retainedFailedPayments(value);

  return (
    <section className={overviewCard} data-failed-payments={data ? 'available' : 'unavailable'}>
      <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--fg-2)]">
        <CreditCard size={16} className="shrink-0 text-amber-300" aria-hidden="true" />
        {t('failedPayments.title')}
      </h3>

      {!data ? (
        <p className="mt-2 text-sm text-amber-300">{t('failedPayments.unavailable')}</p>
      ) : (
        <>
          <p className="mt-2 text-xs leading-relaxed text-[var(--fg-4)]">
            {t('failedPayments.period', {
              days: data.period_days,
              from: attemptDay(data.window_start),
              to: attemptDay(data.observed_until),
            })}
          </p>

          {data.attempts === 0 ? (
            <p className="mt-4 text-sm text-[var(--fg-3)]">{t('failedPayments.none')}</p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--ink-4)]/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className="font-mono text-2xl font-semibold text-amber-300"
                      data-failed-count="attempts"
                    >
                      {formatGrouped(data.attempts, locale)}
                    </p>
                    <TriangleAlert size={20} className="shrink-0 text-[var(--fg-5)]" aria-hidden="true" />
                  </div>
                  <p className="mt-2 text-xs font-medium text-[var(--fg-2)]">{t('failedPayments.attempts')}</p>
                </div>
                <div className="rounded-xl border border-[var(--ink-4)]/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`font-mono text-2xl font-semibold ${data.unrecovered_buyers > 0 ? 'text-red-400' : 'text-[var(--ok)]'}`}
                      data-failed-count="unrecovered"
                    >
                      {formatGrouped(data.unrecovered_buyers, locale)}
                    </p>
                    <RotateCcw size={20} className="shrink-0 text-[var(--fg-5)]" aria-hidden="true" />
                  </div>
                  <p className="mt-2 text-xs font-medium text-[var(--fg-2)]">{t('failedPayments.unrecovered')}</p>
                </div>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-[var(--fg-4)]">{t('failedPayments.recoveredNote')}</p>

              {data.latest.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-[var(--ink-4)]/60 pt-3">
                  {data.latest.slice(0, 6).map((a) => (
                    <li
                      key={`${a.created_at}-${a.email ?? ''}-${a.amount_minor ?? 0}`}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs"
                    >
                      <span className="font-mono tabular-nums text-[var(--fg-3)]">{attemptDay(a.created_at)}</span>
                      <span className="font-mono tabular-nums text-[var(--fg-1)]">
                        {a.amount_minor == null || a.currency == null
                          ? '—'
                          : `${formatGrouped(a.amount_minor / 100, locale, 2)} ${a.currency.toUpperCase()}`}
                      </span>
                      <span className="min-w-0 break-all text-[var(--fg-2)]">{a.email ?? t('failedPayments.noEmail')}</span>
                      <span className="text-[var(--fg-4)]">{t(`failedPayments.reason.${declineKey(a.decline_reason)}`)}</span>
                      {a.recovered ? (
                        <span className="rounded-full bg-[var(--ok)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--ok)]">
                          {t('failedPayments.recovered')}
                        </span>
                      ) : (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400">
                          {t('failedPayments.lost')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <details className="mt-4 border-t border-[var(--ink-4)]/60 pt-3 text-xs">
            <summary className="cursor-pointer font-medium text-[var(--fg-3)]">{t('failedPayments.method')}</summary>
            <ul className="mt-3 list-disc space-y-2 pl-4 leading-relaxed text-[var(--fg-4)]">
              {(['source', 'recoveredRule', 'notCharged', 'limits'] as const).map((k) => (
                <li key={k}>{t(`failedPayments.${k}`)}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
