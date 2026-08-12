import { InfoDot } from './info-dot';

/**
 * Which access channel actually converts: MCP (hosted / stdio), plain REST,
 * browser, or bot traffic. Fed by /stats/sources, which was implemented
 * months before anything displayed it — the AI-recommendation channel thesis
 * ("agents find us through MCP") is finally checkable on the page itself.
 */
export interface ChannelRow {
  client_kind: string;
  total: number;
  paid_calls: number;
  paywall_hits: number;
  errors: number;
  avg_response_ms: number;
}

const KIND_LABEL: Record<string, { label: string; color: string }> = {
  mcp_http: { label: 'MCP hébergé', color: '#a78bfa' },
  mcp_stdio: { label: 'MCP stdio (npm)', color: '#8b5cf6' },
  api: { label: 'REST direct', color: '#3b82f6' },
  web: { label: 'Navigateur', color: '#22c55e' },
  bot: { label: 'Bots / crawlers', color: '#71717a' },
};

export function ChannelsPanel({ rows, periodDays }: { rows: ChannelRow[]; periodDays: number }) {
  const sorted = [...rows].sort((a, z) => z.total - a.total);
  return (
    <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <p className="text-sm font-medium text-[var(--fg-2)]">Canaux d&rsquo;accès — {periodDays} jours</p>
        <InfoDot>
          Le trafic par mode d&rsquo;accès. « Payés » = 200 sur un endpoint facturable (clé ou x402) ; « paywall » =
          402, l&rsquo;agent voulait mais n&rsquo;a pas payé. C&rsquo;est la vue qui vérifie la thèse du canal
          reco-IA : si MCP convertit, ça se voit ici.
        </InfoDot>
      </div>
      {sorted.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-[var(--fg-5)]">Aucun trafic sur la période.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--ink-4)] text-left text-xs uppercase tracking-wide text-[var(--fg-4)]">
                <th className="pb-2 font-medium">Canal</th>
                <th className="pb-2 text-right font-medium">Requêtes</th>
                <th className="pb-2 text-right font-medium">Payées</th>
                <th className="pb-2 text-right font-medium">Paywall</th>
                <th className="pb-2 text-right font-medium">Erreurs</th>
                <th className="pb-2 text-right font-medium">Latence moy.</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const meta = KIND_LABEL[r.client_kind] ?? { label: r.client_kind, color: '#71717a' };
                return (
                  <tr key={r.client_kind} className="border-b border-[var(--ink-4)]/50 last:border-0">
                    <td className="py-2.5">
                      <span className="flex items-center gap-2 text-[var(--fg-1)]">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs text-[var(--fg-2)]">{r.total.toLocaleString('fr-CH')}</td>
                    <td className="py-2.5 text-right font-mono text-xs text-emerald-400">{r.paid_calls.toLocaleString('fr-CH')}</td>
                    <td className="py-2.5 text-right font-mono text-xs text-amber-400">{r.paywall_hits.toLocaleString('fr-CH')}</td>
                    <td className="py-2.5 text-right font-mono text-xs text-[var(--fg-3)]">{r.errors.toLocaleString('fr-CH')}</td>
                    <td className="py-2.5 text-right font-mono text-xs text-[var(--fg-3)]">{Math.round(r.avg_response_ms)} ms</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
