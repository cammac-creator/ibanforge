interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendLabel?: string;
  icon?: React.ReactNode;
}

export function StatCard({ title, value, subtitle, trend, trendLabel, icon }: StatCardProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-700 transition-colors">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          {title}
        </p>
        {icon && (
          <div className="text-zinc-600">{icon}</div>
        )}
      </div>
      <p className="mt-2 text-3xl font-bold text-amber-400">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {subtitle && (
          <p className="text-sm text-zinc-500">{subtitle}</p>
        )}
        {trend && trend !== 'neutral' && trendLabel && (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-medium ${
              trend === 'up' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {trend === 'up' ? '↑' : '↓'} {trendLabel}
          </span>
        )}
      </div>
    </div>
  );
}
