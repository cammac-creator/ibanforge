'use client';

interface UptimeCheck {
  date: string;
  status: 'up' | 'down';
  response_ms: number;
}

interface UptimeBarProps {
  checks: UptimeCheck[];
}

function getBarColor(status: 'up' | 'down' | null): string {
  if (status === 'up') return '#22c55e';
  if (status === 'down') return '#ef4444';
  return '#3f3f46'; // zinc-700 for no data
}

export function UptimeBar({ checks }: UptimeBarProps) {
  // Build a map of date -> check for fast lookup
  const checkMap = new Map<string, UptimeCheck>();
  for (const check of checks) {
    const day = check.date.slice(0, 10);
    // Keep the most recent check per day (last write wins)
    checkMap.set(day, check);
  }

  // Generate the last 30 days
  const days: { dateKey: string; label: string }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('fr-CH', {
      day: '2-digit',
      month: 'short',
    });
    days.push({ dateKey, label });
  }

  return (
    <div className="flex items-end gap-[3px] h-8">
      {days.map(({ dateKey, label }) => {
        const check = checkMap.get(dateKey) ?? null;
        const color = getBarColor(check ? check.status : null);
        const title = check
          ? `${label} — ${check.status === 'up' ? 'En ligne' : 'Hors ligne'} · ${check.response_ms} ms`
          : `${label} — Aucune donnée`;

        return (
          <div
            key={dateKey}
            title={title}
            style={{ backgroundColor: color }}
            className="flex-1 h-full rounded-sm cursor-default transition-opacity hover:opacity-70"
          />
        );
      })}
    </div>
  );
}
