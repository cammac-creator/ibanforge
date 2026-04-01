interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
}

export function StatCard({ title, value, subtitle }: StatCardProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {title}
      </p>
      <p className="mt-2 text-3xl font-bold text-amber-400">{value}</p>
      {subtitle && (
        <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
      )}
    </div>
  );
}
