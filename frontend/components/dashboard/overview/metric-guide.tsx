import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { localePath } from '@/lib/locale-path';
import styles from './business.module.css';

/** Les unités et limites sont expliquées au même endroit que les chiffres. */
export async function MetricGuide({ locale }: { locale: string }) {
  const p = await getTranslations('dashboard.pilot');
  const base = localePath(locale, '/dashboard');
  const entries = [
    ['accounts', `${base}/clients`],
    ['buyers', `${base}?view=revenue`],
    ['visits', `${base}?view=growth&audience=site`],
    ['requests', `${base}?view=service`],
    ['revenue', `${base}?view=revenue`],
    ['conversion', `${base}?view=growth&audience=journey`],
    ['return', `${base}?view=growth&audience=journey`],
    ['errors', `${base}?view=service`],
    ['google', `${base}?view=growth&audience=google`],
    ['freshness', `${base}?view=service`],
  ];
  return (
    <details id="metric-guide" className={styles.guide}>
      <summary>{p('guideTitle')}</summary>
      <p>{p('guideIntro')}</p>
      <div className={styles.guideGrid}>
        {entries.map(([key, href]) => (
          <article className={styles.guideItem} key={key}>
            <h3>{p(`guide.${key}.title`)}</h3>
            <p>{p(`guide.${key}.body`)}</p>
            <Link href={href} prefetch={false}>
              {p('openAnalysis')} →
            </Link>
          </article>
        ))}
      </div>
    </details>
  );
}
