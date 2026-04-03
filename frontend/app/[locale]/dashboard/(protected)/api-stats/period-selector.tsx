'use client';

import { useRouter, usePathname } from 'next/navigation';

const PERIODS = [
  { label: '7 jours', shortLabel: '7j', value: 7 },
  { label: '30 jours', shortLabel: '30j', value: 30 },
  { label: '90 jours', shortLabel: '90j', value: 90 },
];

interface PeriodSelectorProps {
  current: number;
}

export function PeriodSelector({ current }: PeriodSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();

  function handleSelect(period: number) {
    router.push(`${pathname}?period=${period}`);
  }

  return (
    <div className="flex gap-1 rounded-xl border border-zinc-700 bg-zinc-900 p-1">
      {PERIODS.map(({ label, shortLabel, value }) => (
        <button
          key={value}
          onClick={() => handleSelect(value)}
          className={[
            'rounded-lg px-4 py-1.5 text-sm font-medium transition-all',
            current === value
              ? 'bg-amber-500 text-zinc-950 shadow-lg shadow-amber-500/20'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800',
          ].join(' ')}
        >
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">{shortLabel}</span>
        </button>
      ))}
    </div>
  );
}
