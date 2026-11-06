'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatGrouped } from '@/lib/format-grouped';
import { completeWeekChange, shortDay, type BusinessPulse } from '@/lib/dashboard/business-pulse';
import styles from './business.module.css';

/** Courbes consultables au toucher, au clavier et sous forme de tableau. */
export function BusinessCharts({ data, period }: { data: BusinessPulse; period: number }) {
  const p = useTranslations('dashboard.pilot');
  const locale = useLocale();
  const id = useId();
  const days = data.days.slice(-period);
  const [selected, setSelected] = useState<string | null>(null);
  const [weekIndex, setWeekIndex] = useState(7);
  const index = Math.max(
    0,
    selected ? days.findIndex((d) => d.date === selected) : days.length - 1,
  );
  const day = days[index];
  const maximum = Math.max(1, ...days.map((d) => d.active_accounts));
  const width = 640,
    height = 184,
    left = Math.max(30, formatGrouped(maximum, locale).length * 7 + 8),
    right = 14,
    top = 16,
    bottom = 24;
  const x = (i: number) => left + (i / Math.max(1, days.length - 1)) * (width - left - right);
  const y = (n: number) => height - bottom - (n / maximum) * (height - top - bottom);
  const complete = days.slice(0, -1);
  const points = complete.map((d, i) => `${x(i)},${y(d.active_accounts)}`).join(' ');
  const last = days.length - 1;
  const week = data.weeks[weekIndex];
  const weekMax = Math.max(1, ...data.weeks.flatMap((w) => [w.new_accounts, w.new_buyers]));
  const delta = completeWeekChange(data, 'new_accounts');
  const fmt = (n: number) => formatGrouped(n, locale);
  return (
    <div className={styles.charts}>
      <section className={styles.chartCard} aria-labelledby={`${id}-activity`}>
        <div className={styles.chartHeading}>
          <div>
            <p className={styles.eyebrow}>{p('usage')}</p>
            <h3 id={`${id}-activity`}>{p('dailyTitle')}</h3>
          </div>
          <span className={styles.tag}>{p('days', { count: period })}</span>
        </div>
        <div className={styles.reading} aria-live="polite">
          <strong>{fmt(day.active_accounts)}</strong>
          <span>
            {p('accountsOn', { date: shortDay(day.date, locale), count: day.active_accounts })}
            {index === last ? ` · ${p('inProgress')}` : ''}
          </span>
        </div>
        <svg
          className={styles.lineChart}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={p('dailyTitle')}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const point = ((event.clientX - box.left) / box.width) * width;
            const i = Math.max(
              0,
              Math.min(last, Math.round(((point - left) / (width - left - right)) * last)),
            );
            setSelected(days[i].date);
          }}
        >
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#238775" stopOpacity=".2" />
              <stop offset="100%" stopColor="#238775" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, maximum].map((n) => (
            <g key={n}>
              <line x1={left} x2={width - right} y1={y(n)} y2={y(n)} stroke="#e4e9e5" />
              <text x="0" y={y(n) + 4} fontSize="11" fill="#64736e">
                {fmt(n)}
              </text>
            </g>
          ))}
          <polygon
            points={`${x(0)},${y(0)} ${points} ${x(last - 1)},${y(0)}`}
            fill={`url(#${id}-fill)`}
          />
          <polyline
            points={points}
            fill="none"
            stroke="#18715e"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <line
            x1={x(last - 1)}
            x2={x(last)}
            y1={y(days[last - 1].active_accounts)}
            y2={y(days[last].active_accounts)}
            stroke="#18715e"
            strokeWidth="2"
            strokeDasharray="4 5"
          />
          <line
            x1={x(index)}
            x2={x(index)}
            y1={top}
            y2={y(0)}
            stroke="#b5c8c0"
            strokeDasharray="3 4"
          />
          <circle
            cx={x(index)}
            cy={y(day.active_accounts)}
            r="5"
            fill="#18715e"
            stroke="white"
            strokeWidth="2"
          />
          <text x={left} y={height - 3} fontSize="11" fill="#64736e">
            {shortDay(days[0].date, locale)}
          </text>
          <text x={width - right} y={height - 3} fontSize="11" fill="#64736e" textAnchor="end">
            {shortDay(days[last].date, locale)}
          </text>
        </svg>
        <label className={styles.sliderLabel} htmlFor={`${id}-day`}>
          {p('inspectDay')}
        </label>
        <input
          id={`${id}-day`}
          className={styles.slider}
          type="range"
          min="0"
          max={last}
          value={index}
          aria-valuetext={`${shortDay(day.date, locale)} : ${fmt(day.active_accounts)} ${p('accounts')}`}
          onChange={(e) => setSelected(days[Number(e.target.value)].date)}
        />
        <p className={styles.chartNote}>{p('dayNote')}</p>
        <details className={styles.tableDetails}>
          <summary>{p('dataTable')}</summary>
          <div
            className={styles.tableScroll}
            tabIndex={0}
            role="region"
            aria-label={p('dailyTitle')}
          >
            <table>
              <caption>{p('dailyTitle')}</caption>
              <thead>
                <tr>
                  <th>{p('date')}</th>
                  <th>{p('accounts')}</th>
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map((d) => (
                  <tr key={d.date}>
                    <th scope="row">
                      {shortDay(d.date, locale)}
                      {d.date === data.days.at(-1)?.date ? ` · ${p('inProgress')}` : ''}
                    </th>
                    <td>{fmt(d.active_accounts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
      <section className={styles.chartCard} aria-labelledby={`${id}-growth`}>
        <div className={styles.chartHeading}>
          <div>
            <p className={styles.eyebrow}>{p('acquisition')}</p>
            <h3 id={`${id}-growth`}>{p('weeklyTitle')}</h3>
          </div>
          <span className={styles.tag}>{p('eightWeeks')}</span>
        </div>
        <div className={styles.weekReading} aria-live="polite">
          <strong>
            {p('weekOf', { date: shortDay(week.start, locale) })}
            {week.partial ? ` · ${p('inProgress')}` : ''}
          </strong>
          <span>
            {p('weekCounts', {
              accounts: fmt(week.new_accounts),
              buyers: fmt(week.new_buyers),
              accountsCount: week.new_accounts,
              buyersCount: week.new_buyers,
            })}
          </span>
        </div>
        <div className={styles.weekBars}>
          {data.weeks.map((w, i) => (
            <button
              type="button"
              key={w.start}
              aria-pressed={i === weekIndex}
              onClick={() => setWeekIndex(i)}
              className={styles.weekButton}
              aria-label={`${p('weekOf', { date: shortDay(w.start, locale) })}, ${p('weekCounts', { accounts: fmt(w.new_accounts), buyers: fmt(w.new_buyers), accountsCount: w.new_accounts, buyersCount: w.new_buyers })}${w.partial ? `, ${p('inProgress')}` : ''}`}
            >
              <span className={styles.barPair} data-partial={w.partial} aria-hidden>
                <i style={{ height: `${(w.new_accounts / weekMax) * 100}%` }} />
                <i style={{ height: `${(w.new_buyers / weekMax) * 100}%` }} />
              </span>
              <span>{shortDay(w.start, locale)}</span>
            </button>
          ))}
        </div>
        <div className={styles.legend}>
          <span>
            <i />
            {p('accountLegend')}
          </span>
          <span>
            <i />
            {p('buyerLegend')}
          </span>
        </div>
        <p className={styles.chartNote}>{p('weekNote')}</p>
        <p className={styles.comparison}>
          {p('completedChange', {
            value: `${delta > 0 ? '+' : ''}${fmt(delta)}`,
            date: shortDay(data.weeks[6].start, locale),
          })}
        </p>
        <details className={styles.tableDetails}>
          <summary>{p('dataTable')}</summary>
          <div
            className={styles.tableScroll}
            tabIndex={0}
            role="region"
            aria-label={p('weeklyTitle')}
          >
            <table>
              <caption>{p('weeklyTitle')}</caption>
              <thead>
                <tr>
                  <th>{p('week')}</th>
                  <th>{p('accountLegend')}</th>
                  <th>{p('buyerLegend')}</th>
                </tr>
              </thead>
              <tbody>
                {[...data.weeks].reverse().map((w) => (
                  <tr key={w.start}>
                    <th scope="row">
                      {shortDay(w.start, locale)}
                      {w.partial ? ` · ${p('inProgress')}` : ''}
                    </th>
                    <td>{fmt(w.new_accounts)}</td>
                    <td>{fmt(w.new_buyers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </div>
  );
}
