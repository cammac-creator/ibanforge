/** Ne pas tracer de continuité fictive ni traiter le jour courant comme une journée terminée. */
export function dailySparkline(
  rows: unknown,
  field: string,
  nowIso: string,
): { values: number[]; partialLast: boolean } {
  const empty = { values: [], partialLast: false };
  if (!Array.isArray(rows) || !Number.isFinite(Date.parse(nowIso))) return empty;
  const today = new Date(nowIso).toISOString().slice(0, 10);
  const tail = rows.slice(-7);
  let previous = 0;
  const values: number[] = [];
  for (const row of tail) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
    )
      return empty;
    const at = Date.parse(`${row.date}T00:00:00Z`);
    if (
      !Number.isFinite(at) ||
      new Date(at).toISOString().slice(0, 10) !== row.date ||
      row.date > today
    )
      return empty;
    if (values.length && at - previous !== 86_400_000) return empty;
    const value: unknown = row[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return empty;
    values.push(value);
    previous = at;
  }
  return { values, partialLast: tail.length > 0 && tail[tail.length - 1].date === today };
}

export function operationCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
