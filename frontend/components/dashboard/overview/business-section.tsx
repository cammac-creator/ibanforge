import Link from 'next/link';
import { Activity, ArrowUpRight, CalendarDays, Repeat2, UserPlus, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { formatGrouped } from '@/lib/format-grouped';
import { localePath } from '@/lib/locale-path';
import { readBusinessPulse, shortDay } from '@/lib/dashboard/business-pulse';
import { BusinessCharts } from './business-charts';
import type { Fetched } from './fetching';
import styles from './business.module.css';

export async function BusinessSection({
  promise,
  locale,
  period,
  nowIso,
}: {
  promise: Promise<Fetched<unknown>>;
  locale: string;
  period: number;
  nowIso: string;
}) {
  const p = await getTranslations('dashboard.pilot');
  const response = await promise;
  const data = response.ok ? readBusinessPulse(response.data) : null;
  const fmt = (n: number | undefined) => (n === undefined ? '—' : formatGrouped(n, locale));
  const week = data?.weeks.at(-1);
  const today = data?.days.at(-1);
  const stale = data && Date.parse(nowIso) - Date.parse(data.generated_at) > 15 * 60000;
  const base = localePath(locale, '/dashboard');
  const cards = [
    {
      id: 'activeToday',
      value: today?.active_accounts,
      icon: Activity,
      foot: p('dayOpen'),
      hint: p('activeHint'),
      href: localePath(locale, '/dashboard/clients'),
    },
    {
      id: 'newAccounts',
      value: week?.new_accounts,
      icon: UserPlus,
      foot: p('weekOpen'),
      hint: p('accountsHint'),
      href: `${base}?view=growth&period=${period}&audience=journey`,
    },
    {
      id: 'newBuyers',
      value: week?.new_buyers,
      icon: CalendarDays,
      foot: p('weekOpen'),
      hint: p('buyersHint'),
      href: `${base}?view=revenue&period=${period}`,
    },
    {
      id: 'activeWeek',
      value: data?.totals.active_7d,
      icon: Users,
      foot: p('lastSeven'),
      hint: p('weekActiveHint'),
      href: localePath(locale, '/dashboard/clients'),
    },
  ];
  return (
    <section className={styles.section} aria-labelledby="pilot-title">
      <div className={styles.intro}>
        <div>
          <h2 id="pilot-title">{p('essentials')}</h2>
        </div>
        <a href="#metric-guide" className={styles.guideLink}>
          {p('understand')} <ArrowUpRight size={15} aria-hidden />
        </a>
      </div>
      {!data && (
        <p role="status" className={styles.notice}>
          {p('unavailable')}
        </p>
      )}
      {stale && (
        <p role="status" className={styles.notice}>
          {p('stale')}
        </p>
      )}
      <div className={styles.metrics}>
        {cards.map(({ id, value, icon: Icon, foot, hint, href }) => (
          <article key={id} className={styles.metric} data-featured={id === 'activeToday'}>
            <div className={styles.cardHeading}>
              <h3>{p(id)}</h3>
              <Icon size={19} strokeWidth={1.7} aria-hidden />
            </div>
            <strong className={styles.value}>{fmt(value)}</strong>
            <p className={styles.period}>{foot}</p>
            <p className={styles.definition}>{hint}</p>
            <Link href={href} prefetch={false} className={styles.cardLink}>
              {p('explore')}
              <ArrowUpRight size={15} aria-hidden />
            </Link>
          </article>
        ))}
      </div>
      {data && (
        <>
          <div className={styles.context}>
            <span>
              <Repeat2 size={17} aria-hidden />
              <strong>{fmt(data.totals.returning_7d)}</strong>{' '}
              {p('returning', { count: data.totals.returning_7d })}
            </span>
            <span>
              <strong>{fmt(data.totals.known_accounts)}</strong>{' '}
              {p('known', { count: data.totals.known_accounts })}
            </span>
            <span>
              <strong>{fmt(data.totals.buyer_accounts)}</strong>{' '}
              {p('buyersTotal', { count: data.totals.buyer_accounts })}
            </span>
          </div>
          <BusinessCharts data={data} period={period} />
          <p className={styles.source}>
            {p('asOf', {
              date: shortDay(data.generated_at.slice(0, 10), locale),
              time: data.generated_at.slice(11, 16),
            })}{' '}
            · {p('scope')}
          </p>
        </>
      )}
    </section>
  );
}
