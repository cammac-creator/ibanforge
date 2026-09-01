import type { ActivationClientRow } from '../clients-table';
import type { ActivationFunnelData } from '../activation-funnel';
import type { AcquisitionCohortRow, AcquisitionSourceRow } from '../acquisition-panel';

/**
 * The upstream payload shapes the overview reads.
 *
 * They used to live inside page.tsx, which was fine while the page was one
 * function. Now that each section fetches and renders on its own (ENS-05),
 * they are shared, and shared once: a payload retyped beside its second
 * consumer is how two blocks end up disagreeing about the same field.
 */
export interface StatsResponse {
  total_requests: number;
  requests_today: number;
  requests_by_path: Array<{ path: string; count: number; avg_ms: number }>;
  by_type: {
    iban_validate: { total: number; valid_count: number; success_rate: number };
    iban_batch: { total: number; valid_count: number; success_rate: number };
    bic_lookup: { total: number; found_count: number; hit_rate: number };
  };
  total_revenue_usdc: number;
  total_revenue_usdc_clean: number;
  last_write_at: string | null;
  top_countries: Array<{ country: string; count: number }>;
}

export interface HistoryEntry {
  date: string;
  expected_min: number | null;
  expected_max: number | null;
  iban_validate: number;
  iban_batch: number;
  bic_lookup: number;
  revenue_usdc: number;
  total_requests: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
}

export interface ErrorsResponse {
  error_rate: {
    iban_validate: { rate: number; trend: number[] };
    bic_lookup: { rate: number; trend: number[] };
  };
  top_invalid_ibans: Array<{ prefix: string; country: string; count: number; error_type: string }>;
  top_missing_bics: Array<{ bic: string; country: string; count: number }>;
}

export interface HourlyResponse {
  heatmap: Array<{ day: number; hour: number; total: number }>;
}

export interface ActivationData {
  clients: ActivationClientRow[];
  funnel: ActivationFunnelData;
  sources: AcquisitionSourceRow[];
  cohorts: AcquisitionCohortRow[];
}
