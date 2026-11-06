import type { SourceFreshnessEntry } from '@/components/dashboard/living-tool-card';
import type { StatusByPathRow } from '@/components/dashboard/status-by-path-table';
import type { ErrorsResponse } from '@/components/dashboard/overview/types';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
const count = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const percent = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;

/** Un tableau vide de statuts est un fait lisible ; un champ manquant ne l’est pas. */
export function readServiceStatuses(value: unknown): StatusByPathRow[] | null {
  const rows = record(value)?.rows;
  if (!Array.isArray(rows)) return null;
  if (
    !rows.every((item) => {
      const r = record(item);
      return (
        r &&
        typeof r.path === 'string' &&
        r.path.length > 0 &&
        count(r.total) &&
        ['s2xx', 's3xx', 's4xx', 's5xx'].every(
          (key) => count(r[key]) && (r[key] as number) <= (r.total as number),
        ) &&
        (r.avg_ms === null ||
          (typeof r.avg_ms === 'number' && Number.isFinite(r.avg_ms) && r.avg_ms >= 0))
      );
    })
  )
    return null;
  return rows as StatusByPathRow[];
}

/** Aucune source lue ne permet pas de conclure « tous les registres sont frais ». */
export function readServiceSources(value: unknown): SourceFreshnessEntry[] | null {
  const sources = record(value)?.bic_sources;
  if (!Array.isArray(sources) || sources.length === 0) return null;
  if (
    !sources.every((item) => {
      const s = record(item);
      return (
        s &&
        typeof s.source === 'string' &&
        s.source.length > 0 &&
        count(s.entries) &&
        typeof s.stale === 'boolean' &&
        (s.last_updated === null || typeof s.last_updated === 'string') &&
        (s.stale_reason === undefined ||
          s.stale_reason === null ||
          ['import_overdue', 'source_frozen'].includes(String(s.stale_reason)))
      );
    })
  )
    return null;
  return sources as SourceFreshnessEntry[];
}

export function readServiceErrorRates(value: unknown): ErrorsResponse['error_rate'] | null {
  const rates = record(record(value)?.error_rate);
  function read(name: string) {
    const entry = record(rates?.[name]);
    if (!entry || !percent(entry.rate)) return null;
    // Une série absente ne détruit pas un taux lisible, mais ne trace rien.
    const trend = Array.isArray(entry.trend) && entry.trend.every(percent) ? entry.trend : [];
    return { rate: entry.rate, trend };
  }
  const iban_validate = read('iban_validate'),
    bic_lookup = read('bic_lookup');
  return iban_validate && bic_lookup ? { iban_validate, bic_lookup } : null;
}

/** Validité des données soumises, distincte de la disponibilité technique. */
export function validIbanShare(value: unknown): number | null {
  const entry = record(record(record(value)?.by_type)?.iban_validate);
  if (
    !entry ||
    !count(entry.total) ||
    entry.total === 0 ||
    !count(entry.valid_count) ||
    entry.valid_count > entry.total
  )
    return null;
  return (entry.valid_count / entry.total) * 100;
}
