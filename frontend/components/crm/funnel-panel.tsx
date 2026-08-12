import type { FunnelRow } from '@/lib/crm/funnel';

/**
 * What each cut of the list actually produced, end to end.
 *
 * A Server Component with no directive and no state: everything it shows is
 * derived from the same payload the page already fetched, and putting it
 * behind a <details> costs nothing when closed. Collapsed by default because
 * the day's work is the queue below, not this; open it when deciding what to
 * source next.
 */

/** One percentage, or a dash when the denominator is zero. */
function rate(n: number, d: number): string {
  if (!d) return '·';
  return `${Math.round((n / d) * 100)} %`;
}

function Table({ title, hint, rows }: { title: string; hint?: string; rows: FunnelRow[] }) {
  if (rows.length === 0) return null;
  const total = rows.reduce(
    (a, r) => ({
      stock: a.stock + r.stock,
      mailed: a.mailed + r.mailed,
      followed: a.followed + r.followed,
      replied: a.replied + r.replied,
      converted: a.converted + r.converted,
    }),
    { stock: 0, mailed: 0, followed: 0, replied: 0, converted: 0 },
  );
  return (
    <div className="min-w-0">
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--fg-2)]">{title}</h3>
      {hint && <p className="mt-0.5 text-[12px] text-[var(--fg-3)]">{hint}</p>}
      {/* The table scrolls inside its own box rather than widening the page. */}
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[12px] uppercase text-[var(--fg-3)]">
              <th className="py-1 pr-2 font-medium">&nbsp;</th>
              <th className="py-1 pr-2 text-right font-medium">stock</th>
              <th className="py-1 pr-2 text-right font-medium">mailés</th>
              <th className="py-1 pr-2 text-right font-medium">relancés</th>
              <th className="py-1 pr-2 text-right font-medium">réponses</th>
              <th className="py-1 pr-2 text-right font-medium">taux</th>
              <th className="py-1 text-right font-medium">clients</th>
            </tr>
          </thead>
          <tbody className="tabular-nums text-[var(--fg-2)]">
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-[var(--ink-4)]/40">
                <td className="py-1 pr-2 wrap-anywhere text-[var(--fg-1)]">{r.label}</td>
                <td className="py-1 pr-2 text-right">{r.stock}</td>
                <td className="py-1 pr-2 text-right">{r.mailed}</td>
                <td className="py-1 pr-2 text-right">{r.followed}</td>
                <td className="py-1 pr-2 text-right">{r.replied}</td>
                {/* Of those actually mailed, not of the stock: a segment half
                    written to would otherwise look half as good as it is. */}
                <td className="py-1 pr-2 text-right text-[var(--fg-3)]">{rate(r.replied, r.mailed)}</td>
                <td className="py-1 text-right">{r.converted || ''}</td>
              </tr>
            ))}
            <tr className="border-t border-[var(--ink-4)] font-medium text-[var(--fg-1)]">
              <td className="py-1 pr-2">Total</td>
              <td className="py-1 pr-2 text-right">{total.stock}</td>
              <td className="py-1 pr-2 text-right">{total.mailed}</td>
              <td className="py-1 pr-2 text-right">{total.followed}</td>
              <td className="py-1 pr-2 text-right">{total.replied}</td>
              <td className="py-1 pr-2 text-right text-[var(--fg-3)]">{rate(total.replied, total.mailed)}</td>
              <td className="py-1 text-right">{total.converted || ''}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FunnelPanel({
  bySegment,
  byCampaign,
  byConfidence,
  byCountry,
}: {
  bySegment: FunnelRow[];
  byCampaign: FunnelRow[];
  byConfidence: FunnelRow[];
  byCountry: FunnelRow[];
}) {
  return (
    <details className="min-w-0 rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-[var(--fg-1)] marker:content-none">
        Ce que chaque campagne a donné
        <span className="ml-2 text-[12px] font-normal text-[var(--fg-3)]">
          stock, envoyés, relancés, réponses, conversions
        </span>
      </summary>
      <div className="space-y-5 border-t border-[var(--ink-4)]/60 p-4">
        <p className="text-[12px] text-[var(--fg-3)]">
          Une relance est comptée quand deux mails partent d’affilée sans réponse entre les deux, pas
          quand un contact a reçu deux mails. Les accusés de réception automatiques ne comptent ni
          comme réponse ni comme rupture de relance. Attention aux petits effectifs : sur une
          quinzaine d’envois, zéro réponse ne prouve pas grand-chose.
        </p>
        <Table title="Par segment" rows={bySegment} />
        <Table title="Par campagne" rows={byCampaign} />
        <Table title="Par confiance du sourcing" rows={byConfidence} />
        <Table
          title="Par pays"
          hint="Libellés normalisés à la lecture. Les lignes dont le texte ne nomme aucun pays sont regroupées, jamais retirées."
          rows={byCountry}
        />
      </div>
    </details>
  );
}
