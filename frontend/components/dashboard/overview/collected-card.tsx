import { getTranslations } from 'next-intl/server';
import { StatCardV2 } from '../stat-card-v2';
import { collectedView, type StripeRevenuePayload } from '@/lib/dashboard/stripe-revenue';

/**
 * La tuile « Encaissé » : ce que Stripe a encaissé, par nature (packs,
 * abonnements, audits), avec le net et les virements dans la devise du compte
 * et l'heure de la lecture. Si Stripe ne répond pas, le total selon nos propres
 * traces, annoncé comme tel et jamais présenté comme la lecture de Stripe.
 *
 * Composant serveur : les montants arrivent déjà mis en forme par
 * lib/dashboard/stripe-revenue.ts, sans Intl.
 */
export async function CollectedCard({ data, locale }: { data: StripeRevenuePayload; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'dashboard.overview' });
  const v = collectedView(data, locale);
  const fromStripe = v.mode === 'stripe';
  return (
    <StatCardV2
      title={t(fromStripe ? 'money.collected.title' : 'money.collected.titleDerived')}
      value={v.headline}
      accentColor="#22c55e"
      hint={t(fromStripe ? 'money.collected.hint' : 'money.collected.hintDerived')}
      detail={
        <>
          <p data-collected-kinds className="flex flex-wrap gap-x-2 gap-y-0.5">
            {v.kinds.map((k, i) => (
              <span key={k.kind} className={k.alert ? 'text-amber-300' : undefined}>
                {i > 0 && <span aria-hidden className="mr-2 text-[var(--fg-5)]">·</span>}
                {t(`money.collected.kinds.${k.kind}`)}{' '}
                <span className="font-mono text-[var(--fg-2)]">{k.amount}</span>
              </span>
            ))}
          </p>
          {fromStripe ? (
            <p data-collected-settlement>
              {v.net ? t('money.collected.net', { amount: v.net }) : t('money.collected.netUnread')}
              {' · '}
              {v.paidOut !== null
                ? t('money.collected.paidOut', { amount: v.paidOut })
                : t('money.collected.payoutsUnread')}
              {v.awaiting !== null ? <>{' · '}{t('money.collected.awaiting', { amount: v.awaiting })}</> : null}
            </p>
          ) : (
            <p data-collected-derived className="text-amber-300">{t('money.collected.derivedNote')}</p>
          )}
          {v.refunded && <p className="text-amber-300">{t('money.collected.refunded', { amount: v.refunded })}</p>}
          {v.partial && <p className="text-amber-300">{t('money.collected.partial')}</p>}
          {v.net && v.netUnknown > 0 && (
            <p className="text-amber-300">{t('money.collected.netUnknown', { count: v.netUnknown })}</p>
          )}
          {v.testMode && <p className="text-amber-300">{t('money.collected.testMode')}</p>}
          {v.excluded > 0 && (
            <p className="text-amber-300">{t('money.collected.derivedExcluded', { count: v.excluded })}</p>
          )}
          {v.readAt && (
            <p data-collected-read-at className="text-[var(--fg-5)]">{t('money.collected.readAt', { at: v.readAt })}</p>
          )}
        </>
      }
    />
  );
}
