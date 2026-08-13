'use client';

import { useTranslations } from 'next-intl';
import { InfoDot } from './info-dot';

interface HeatmapDataPoint {
  day: number;  // 0 = Monday … 6 = Sunday
  hour: number; // 0–23
  total: number;
}

interface HeatmapProps {
  data: HeatmapDataPoint[];
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function cellColor(intensity: number): string {
  if (intensity === 0) return 'bg-[var(--ink-4)]/40';
  if (intensity < 0.25) return 'bg-amber-500/20';
  if (intensity < 0.5) return 'bg-amber-500/40';
  if (intensity < 0.75) return 'bg-amber-500/70';
  return 'bg-amber-500';
}

export function Heatmap({ data }: HeatmapProps) {
  const t = useTranslations('dashboard.analytics.heatmap');

  // Build a 7×24 grid
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let maxVal = 0;

  for (const point of data) {
    if (point.day >= 0 && point.day < 7 && point.hour >= 0 && point.hour < 24) {
      grid[point.day][point.hour] += point.total;
      if (grid[point.day][point.hour] > maxVal) {
        maxVal = grid[point.day][point.hour];
      }
    }
  }

  const isEmpty = data.length === 0;

  return (
    <div className="bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 border border-[var(--ink-4)]/60 rounded-xl p-4">
      <div className="mb-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          {t('title')}
          <InfoDot>
            Chaque case = un jour de la semaine × une heure (UTC). Plus la case est jaune, plus il y a
            eu de requêtes à ce moment-là sur la période. À quoi ça sert : voir QUAND tes clients
            travaillent (un pic à 9 h lun-ven = des intégrations européennes en journée ; une nappe
            continue = des robots), et choisir tes heures d&apos;envoi de mails ou de maintenance.
          </InfoDot>
        </p>
        <p className="text-xs text-[var(--fg-4)] mt-0.5">{t('subtitle')}</p>
      </div>

      {isEmpty ? (
        <p className="text-sm text-[var(--fg-4)] py-6 text-center">{t('noData')}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            {/* Hour labels */}
            <div className="flex ml-8 mb-1">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="flex-1 text-center">
                  {h % 3 === 0 ? (
                    <span className="text-[9px] text-[var(--fg-5)]">{h}h</span>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Grid rows */}
            {grid.map((row, dayIndex) => {
              const dayKey = DAY_KEYS[dayIndex];
              return (
                <div key={dayIndex} className="flex items-center gap-1 mb-0.5">
                  {/* Day label */}
                  <div className="w-7 shrink-0 text-right">
                    <span className="text-[10px] text-[var(--fg-4)]">
                      {t(`days.${dayKey}`)}
                    </span>
                  </div>

                  {/* Hour cells */}
                  {row.map((count, hour) => {
                    const intensity = maxVal > 0 ? count / maxVal : 0;
                    return (
                      <div
                        key={hour}
                        title={`${t(`days.${dayKey}`)} ${hour}h: ${count}`}
                        className={[
                          'flex-1 h-3 rounded-[2px] cursor-default transition-opacity hover:opacity-80',
                          cellColor(intensity),
                        ].join(' ')}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
