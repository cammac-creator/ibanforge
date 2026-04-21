'use client';

import { HoverTooltip } from './info-dot';

export interface StatusByPathRow {
  path: string;
  total: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  avg_ms: number | null;
}

const CLASS_META = [
  { key: 's2xx' as const, label: '2xx', color: '#3b82f6', hint: 'Succès — la requête a été traitée normalement.' },
  { key: 's3xx' as const, label: '3xx', color: '#f59e0b', hint: 'Redirection — le serveur a renvoyé le client vers un autre path.' },
  { key: 's4xx' as const, label: '4xx', color: '#eab308', hint: 'Erreur client — auth manquante (401), paiement requis (402), endpoint inconnu (404), body invalide (400) ou quota atteint (429).' },
  { key: 's5xx' as const, label: '5xx', color: '#ef4444', hint: 'Erreur serveur — bug applicatif ou plateforme indisponible.' },
];

/** Heuristic hint per path family so hover shows what the endpoint actually does. */
function describePath(path: string): string {
  if (path === '/') return 'Landing page HTML.';
  if (path === '/mcp') return 'MCP HTTP transport — outils pour agents AI (50 tools/call/jour/IP gratuits, sinon API key ou x402).';
  if (path === '/stats' || path.startsWith('/stats')) return 'Dashboard interne (STATS_TOKEN).';
  if (path === '/health' || path === '/ping') return 'Health check.';
  if (path.startsWith('/v1/iban/validate')) return 'Validation IBAN — $0.005 ou 1 quota d’API key.';
  if (path.startsWith('/v1/iban/batch')) return 'Batch IBAN — $0.002 par IBAN.';
  if (path.startsWith('/v1/iban/compliance')) return 'Compliance complète (sanctions + VoP + risk score) — $0.02.';
  if (path.startsWith('/v1/bic/')) return 'Lookup BIC/SWIFT avec enrichissement LEI — $0.003.';
  if (path.startsWith('/v1/ch/clearing/')) return 'Lookup clearing suisse BC-Nummer / IID — $0.003.';
  if (path.startsWith('/v1/keys/generate')) return 'Création d’une API key gratuite (200 req/mois).';
  if (path.startsWith('/v1/keys/usage')) return 'Usage mensuel de la clé.';
  if (path.startsWith('/v1/admin/')) return 'Endpoint admin (X-Admin-Secret).';
  if (path.startsWith('/.well-known/')) return 'Métadonnées de découverte pour agents / crawlers.';
  if (path === '/openapi.json') return 'Spec OpenAPI 3.1 publique.';
  if (path === '/llms.txt' || path === '/robots.txt') return 'Fichier de découverte pour bots/LLMs.';
  if (path === '/v1') return 'Index v1 — hint de discovery.';
  return 'Requête enregistrée dans request_log.';
}

/** Color hint: healthy if >60% 2xx; warning if 4xx dominant; danger if any 5xx. */
function healthColor(row: StatusByPathRow): string {
  if (row.s5xx > 0) return '#ef4444';
  if (row.total === 0) return '#71717a';
  const pct2xx = row.s2xx / row.total;
  if (pct2xx >= 0.6) return '#22c55e';
  if (pct2xx >= 0.3) return '#eab308';
  return '#f97316';
}

export function StatusByPathTable({ rows }: { rows: StatusByPathRow[] }) {
  if (rows.length === 0) {
    return <div className="flex h-32 items-center justify-center text-zinc-600 text-sm">Aucune donnée</div>;
  }

  const maxTotal = rows[0]?.total || 1;

  return (
    <div className="space-y-1.5">
      {/* Header */}
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-600">
        <span>Path</span>
        <span className="text-right">ms</span>
        <span className="w-16 text-right">Total</span>
      </div>

      {rows.map((row) => {
        const pct = (row.total / maxTotal) * 100;
        const dotColor = healthColor(row);
        return (
          <div key={row.path} className="group rounded-md px-2 py-1.5 transition-colors hover:bg-zinc-800/30">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <HoverTooltip
                  content={<span>{describePath(row.path)}</span>}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: dotColor }}
                  />
                </HoverTooltip>
                <HoverTooltip content={<span className="font-mono">{row.path}</span>}>
                  <span className="truncate font-mono text-xs text-zinc-200">{row.path}</span>
                </HoverTooltip>
              </div>
              <span className="text-[10px] font-mono text-zinc-600 tabular-nums">
                {row.avg_ms != null ? `${row.avg_ms}ms` : '—'}
              </span>
              <span className="w-16 text-right font-mono text-xs text-purple-400 tabular-nums">
                {row.total.toLocaleString()}
              </span>
            </div>

            {/* Stacked bar of 2xx/3xx/4xx/5xx */}
            <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/60" style={{ maxWidth: `${Math.max(pct, 3)}%` }}>
              {CLASS_META.map((cls) => {
                const value = row[cls.key];
                if (value === 0) return null;
                const segPct = (value / row.total) * 100;
                return (
                  <HoverTooltip
                    key={cls.key}
                    content={
                      <div className="space-y-1">
                        <div className="font-semibold text-zinc-100">
                          {cls.label} · {value.toLocaleString()} ({((value / row.total) * 100).toFixed(1)}%)
                        </div>
                        <div className="text-zinc-400">{cls.hint}</div>
                      </div>
                    }
                  >
                    <span
                      className="h-full block cursor-default"
                      style={{ width: `${segPct}%`, backgroundColor: cls.color }}
                    />
                  </HoverTooltip>
                );
              })}
            </div>

            {/* Per-class counters */}
            <div className="mt-1 flex items-center gap-3 text-[10px] font-mono text-zinc-500 tabular-nums">
              {CLASS_META.map((cls) => {
                const value = row[cls.key];
                if (value === 0) return null;
                return (
                  <HoverTooltip
                    key={cls.key}
                    content={<span>{cls.hint}</span>}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cls.color }} />
                      <span className="text-zinc-400">{cls.label}</span>
                      <span>{value.toLocaleString()}</span>
                    </span>
                  </HoverTooltip>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
