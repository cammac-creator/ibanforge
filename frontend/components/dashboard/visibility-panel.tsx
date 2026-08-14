import { InfoDot } from './info-dot';

/**
 * Where we are listed, and since when. Getting into a directory is a one-off
 * effort; staying in it is nobody's job, and a purge is silent, so this panel
 * exists to make a disappearance loud. A daily VPS probe fills it.
 *
 * Sorted by what needs attention: losses first, then never-listed, then the
 * calm ones. A panel that always reads top-to-bottom the same way is a panel
 * whose first line stops being informative.
 */
export interface SurfaceStatus {
  surface: string;
  state: 'present' | 'absent' | 'error';
  detail: string | null;
  url: string | null;
  checked_on: string;
  last_present_on: string | null;
  lost: boolean;
}

function rank(s: SurfaceStatus): number {
  if (s.lost) return 0;
  if (s.state === 'error') return 1;
  if (s.state === 'absent') return 2;
  return 3;
}

function frDay(iso: string | null): string {
  if (!iso) return 'jamais';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

export function VisibilityPanel({ surfaces }: { surfaces: SurfaceStatus[] }) {
  if (surfaces.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-5">
        <p className="text-sm font-medium text-[var(--fg-2)]">Veille de visibilité</p>
        <p className="mt-1 text-[13px] text-[var(--fg-4)]">
          Aucun relevé encore. La sonde tourne chaque matin et remplira ce tableau.
        </p>
      </div>
    );
  }

  const rows = [...surfaces].sort((a, b) => rank(a) - rank(b) || a.surface.localeCompare(b.surface));
  const present = rows.filter((r) => r.state === 'present').length;
  const lost = rows.filter((r) => r.lost).length;
  const checked = rows[0]?.checked_on ?? null;

  return (
    <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-sm font-semibold text-white">Veille de visibilité</h2>
        <p className="text-[13px] text-[var(--fg-3)]">
          <span className={lost ? 'font-semibold text-red-400' : 'text-teal-400'}>
            {present}/{rows.length} surfaces
          </span>
          {lost > 0 && <span className="text-red-400"> · {lost} perdue{lost > 1 ? 's' : ''}</span>}
          {checked && <span> · relevé du {frDay(checked)}</span>}
        </p>
        <InfoDot>
          Les annuaires et registres où IBANforge est censé figurer, sondés chaque matin. Se faire
          lister est un effort ponctuel ; y rester n&apos;est le travail de personne, et une purge
          est silencieuse. « Perdue » = la surface nous listait et ne nous liste plus, c&apos;est la
          seule ligne qui mérite une action (tu reçois aussi un Telegram le jour où ça arrive).
          « Jamais vu » = on n&apos;y a encore jamais été listé, ce n&apos;est pas une perte. « Sonde
          en échec » = l&apos;annuaire était injoignable, ça ne dit rien de notre présence.
        </InfoDot>
      </div>

      <ul className="divide-y divide-[var(--ink-4)]/50">
        {rows.map((s) => {
          const label =
            s.lost ? 'Perdue' : s.state === 'present' ? 'OK' : s.state === 'error' ? 'Sonde en échec' : 'Jamais vu';
          const color =
            s.lost
              ? 'text-red-300 bg-red-500/15'
              : s.state === 'present'
                ? 'text-teal-300 bg-teal-500/15'
                : s.state === 'error'
                  ? 'text-amber-300 bg-amber-500/15'
                  : 'text-[var(--fg-3)] bg-[var(--ink-4)]';
          return (
            <li key={s.surface} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 py-2">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${color}`}>
                {label}
              </span>
              <span className="text-[13.5px] font-medium text-[var(--fg-1)]">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-amber-400">
                    {s.surface}
                  </a>
                ) : (
                  s.surface
                )}
              </span>
              {s.detail && <span className="min-w-0 text-[12.5px] text-[var(--fg-3)]">{s.detail}</span>}
              {s.lost && (
                <span className="ml-auto text-[12px] text-red-300">
                  vue pour la dernière fois le {frDay(s.last_present_on)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
