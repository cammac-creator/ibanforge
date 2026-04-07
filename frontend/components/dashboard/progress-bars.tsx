interface ProgressBarItem {
  label: string;
  value: number;
  color: string;
  total: number;
}

interface ProgressBarsProps {
  items: ProgressBarItem[];
}

export function ProgressBars({ items }: ProgressBarsProps) {
  const grandTotal = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const pct = grandTotal > 0 ? (item.value / grandTotal) * 100 : 0;
        const barWidth = item.total > 0 ? (item.value / item.total) * 100 : 0;

        return (
          <div key={i} className="flex items-center gap-3">
            {/* Label with color dot */}
            <div className="flex items-center gap-1.5 min-w-0 w-28 shrink-0">
              <span
                className="inline-block h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-xs text-zinc-400 truncate">{item.label}</span>
            </div>

            {/* Bar */}
            <div className="flex-1 h-2 rounded-full bg-zinc-800/60 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(barWidth, 100)}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>

            {/* Count + percentage */}
            <div className="flex items-center gap-1.5 shrink-0 text-right">
              <span className="text-xs font-mono text-zinc-300">{item.value.toLocaleString()}</span>
              <span className="text-[10px] text-zinc-600">
                {pct.toFixed(1)}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
