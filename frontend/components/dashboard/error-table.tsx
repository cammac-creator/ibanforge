interface Column {
  key: string;
  label: string;
  mono?: boolean;
}

interface ErrorTableProps {
  title: string;
  columns: Column[];
  rows: Array<Record<string, string | number>>;
  emptyMessage: string;
}

export function ErrorTable({ title, columns, rows, emptyMessage }: ErrorTableProps) {
  return (
    <div className="bg-gradient-to-br from-zinc-900 to-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800/60">
        <p className="text-sm font-semibold text-white">{title}</p>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-zinc-500">{emptyMessage}</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-800/50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-400"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className={i % 2 === 0 ? 'bg-transparent' : 'bg-zinc-800/20'}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={[
                      'px-4 py-2 text-zinc-300',
                      col.mono ? 'font-mono text-xs' : '',
                    ].join(' ')}
                  >
                    {row[col.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
