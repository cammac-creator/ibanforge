'use client';

import { useRouter, usePathname } from 'next/navigation';

const PERIODS = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
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
    <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
      {PERIODS.map(({ label, value }) => (
        <button
          key={value}
          onClick={() => handleSelect(value)}
          className={
            current === value
              ? 'rounded-md px-3 py-1 text-xs font-medium bg-amber-500 text-zinc-950'
              : 'rounded-md px-3 py-1 text-xs font-medium text-zinc-400 hover:text-white transition'
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
