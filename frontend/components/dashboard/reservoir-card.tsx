import { RESERVOIR_LOW, type Reservoir } from '@/lib/crm/priority';
import { InfoDot } from './info-dot';

/**
 * The prospecting reservoir gauge: how many first mails are actually ready to
 * go, against the owner's low-water mark. The reservoir once ran dry with
 * nothing on any page saying so — this card exists so an empty pipe is a red
 * figure on the overview, not a discovery made weeks later.
 *
 * Server component: the harvest age is computed against the snapshot's UTC
 * day, passed in by the page, so the card renders the same on both sides of
 * hydration. The VPS daily check reads the same threshold for its Telegram
 * alarm; this is the eye, that is the bell.
 */
const GAUGE_FULL = 2 * RESERVOIR_LOW;

function harvestAgeDays(lastHarvestDay: string | null, todayUtc: string): number | null {
  if (!lastHarvestDay) return null;
  const ms = Date.parse(`${todayUtc}T00:00:00Z`) - Date.parse(`${lastHarvestDay}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function ReservoirCard({ reservoir, todayUtc }: { reservoir: Reservoir; todayUtc: string }) {
  const { ready, addressable, toEnrich, lastHarvestDay } = reservoir;
  const low = ready < RESERVOIR_LOW;
  const color = low ? '#ef4444' : ready < GAUGE_FULL ? '#f59e0b' : '#14b8a6';
  const pct = Math.min(100, (ready / GAUGE_FULL) * 100);
  const age = harvestAgeDays(lastHarvestDay, todayUtc);
  const toWrite = addressable - ready;

  return (
    <div className="bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 border border-[var(--ink-4)]/60 rounded-xl p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-4)]">
          Réservoir de prospection
        </p>
        <InfoDot>
          Les premiers mails prêts à partir : prospect avec adresse vérifiée, mail rédigé, jamais
          écrit. Sous {RESERVOIR_LOW}, la jauge passe au rouge et l&apos;alarme Telegram quotidienne
          te prévient : c&apos;est le signal « lance la moisson ». « À rédiger » = adresse trouvée
          mais mail pas encore écrit ; « à enrichir » = pas encore d&apos;adresse ; « moisson » = le
          dernier sourcing de nouvelles cibles (les inscrits spontanés ne comptent pas).
        </InfoDot>
      </div>
      <p className="mb-2 font-mono text-2xl leading-none font-bold text-white">
        {ready}
        <span className="ml-1.5 text-[13px] font-medium text-[var(--fg-3)]">
          mail{ready > 1 ? 's' : ''} prêt{ready > 1 ? 's' : ''}
        </span>
      </p>
      {/* The low-water mark sits mid-gauge: full scale is twice the threshold,
          so "healthy" reads as a bar past its own tick, not a number to recall. */}
      <div className="relative mb-2 h-2 overflow-hidden rounded-full bg-[var(--ink-4)]/60">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" title={`seuil : ${RESERVOIR_LOW}`} />
      </div>
      <p className="text-[11px] leading-snug text-[var(--fg-4)]">
        {toWrite > 0 ? `${toWrite} à rédiger · ` : ''}
        {toEnrich} à enrichir
        {age !== null
          ? ` · moisson ${age === 0 ? "aujourd'hui" : `il y a ${age} j`}`
          : ''}
      </p>
    </div>
  );
}
