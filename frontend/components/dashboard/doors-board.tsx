import { overviewCard } from './overview/section';
import {
  controlLine,
  count,
  digestStatus,
  dayMonth,
  fmt,
  freeUsersCalendarLine,
  sentNumbersIfDifferent,
  weekShort,
  type DoorCounts,
  type DoorRow,
  type DoorsPayload,
  type Tone,
  type WeekRow,
} from '@/lib/dashboard/doors-board';

/**
 * Le tableau des portes du lundi (plan d'audit du 22.09.2026, semaine 2).
 *
 * Composant SERVEUR, sans état ni JavaScript dans le navigateur : il affiche
 * les nombres de `GET /v1/admin/doors` tels quels, ceux-là mêmes que le résumé
 * Telegram du lundi a envoyés. Pensé pour un téléphone : les tableaux gardent
 * six colonnes étroites, le détail par porte se déplie semaine par semaine.
 */

const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200',
  wait: 'border-sky-500/30 bg-sky-500/5 text-sky-200',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
};

const COLUMNS: Array<{ key: keyof DoorCounts; label: string; hint: string }> = [
  { key: 'created', label: 'Créées', hint: 'Clés créées cette semaine-là' },
  { key: 'first_success', label: '1er appel', hint: 'Premier appel réussi cette semaine-là' },
  // Césure douce : sur un téléphone, « Relan-cées » passe sur deux lignes plutôt
  // que de pousser la colonne « Payé » hors du cadre.
  { key: 'nudged', label: 'Relan­cées', hint: 'Relance d’activation remise cette semaine-là' },
  {
    key: 'called_after_nudge',
    label: 'Appel ≤ 7 j',
    hint: 'Relancées cette semaine-là, et qui ont appelé dans les sept jours',
  },
  { key: 'paid', label: 'Payé', hint: 'Premier paiement cette semaine-là' },
];

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/40 px-3 py-2.5">
      <p className="text-[11px] leading-tight text-[var(--fg-4)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--fg-1)]">{fmt(value)}</p>
      {note && <p className="mt-0.5 text-[11px] text-[var(--fg-5)]">{note}</p>}
    </div>
  );
}

function Cell({ row, column }: { row: DoorCounts; column: keyof DoorCounts }) {
  const value = row[column];
  const pending = column === 'called_after_nudge' ? row.followup_pending : 0;
  return (
    <td className="px-1 py-1.5 text-right tabular-nums sm:px-1.5">
      <span className={value === 0 ? 'text-[var(--fg-5)]' : 'text-[var(--fg-1)]'}>{fmt(value)}</span>
      {pending > 0 && (
        <span className="ml-1 text-[10px] text-sky-300" title="Relancées dont les sept jours courent encore">
          +{fmt(pending)}
        </span>
      )}
    </td>
  );
}

function Head({ first }: { first: string }) {
  return (
    <thead>
      <tr className="border-b border-[var(--ink-4)]/60 text-[10.5px] text-[var(--fg-4)] sm:text-[11px]">
        <th scope="col" className="py-1.5 pr-2 text-left align-bottom font-medium">
          {first}
        </th>
        {COLUMNS.map((c) => (
          <th
            key={c.key}
            scope="col"
            title={c.hint}
            className="px-1 py-1.5 text-right align-bottom font-medium leading-tight sm:px-1.5"
          >
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function WeekTable({ weeks, totals }: { weeks: WeekRow[]; totals: DoorCounts }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[20rem] border-collapse text-[12.5px] sm:text-[13px]">
        <Head first="Semaine" />
        <tbody>
          {weeks.map((w) => {
            const short = weekShort(w);
            return (
              <tr key={w.key} className="border-b border-[var(--ink-4)]/30 align-top">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-[var(--fg-2)]">
                  <span className="block whitespace-nowrap">{short.label}</span>
                  {short.detail && (
                    <span className="block whitespace-nowrap text-[10.5px] text-[var(--fg-5)]">
                      {short.detail}
                    </span>
                  )}
                </th>
                {COLUMNS.map((c) => (
                  <Cell key={c.key} row={w.totals} column={c.key} />
                ))}
              </tr>
            );
          })}
          <tr className="font-semibold text-[var(--fg-1)]">
            <th scope="row" className="py-1.5 pr-2 text-left">
              Total
            </th>
            {COLUMNS.map((c) => (
              <Cell key={c.key} row={totals} column={c.key} />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DoorTable({ doors }: { doors: DoorRow[] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[20rem] border-collapse text-[12.5px] sm:text-[13px]">
        <Head first="Porte" />
        <tbody>
          {doors.map((d) => (
            <tr key={d.door} className="border-b border-[var(--ink-4)]/30 align-top">
              <th
                scope="row"
                className="min-w-[5.5rem] py-1.5 pr-2 text-left font-normal leading-snug text-[var(--fg-2)]"
              >
                {d.label}
              </th>
              {COLUMNS.map((c) => (
                <Cell key={c.key} row={d} column={c.key} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DoorsBoard({ data }: { data: DoorsPayload }) {
  const last = data.last_week;
  const free = data.free_users;
  const status = digestStatus(data.digest, last);
  const sent = sentNumbersIfDifferent(data.digest, last);
  const shownWeeks = data.weeks.filter((w) => w.kind === 'current' || w.kind === 'complete');
  const detailWeeks = data.weeks.filter((w) => w.doors.length > 0);
  const progress = Math.min(100, Math.round((free.active / Math.max(1, free.threshold)) * 100));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className={overviewCard} aria-labelledby="doors-last-week">
        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-4)]">
          La semaine passée
        </p>
        <h2 id="doors-last-week" className="mt-0.5 text-base font-semibold text-[var(--fg-1)]">
          {last.title}
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Clés créées" value={last.numbers.created} />
          <Tile label="Premier appel réussi" value={last.numbers.first_success} />
          <Tile label="Ont payé" value={last.numbers.paid} />
          <Tile
            label="Gratuits actifs à 200/mois"
            value={last.numbers.free_active}
            note={`sur 30 jours, seuil ${fmt(free.threshold)}`}
          />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-[var(--fg-2)]">{last.sentence}</p>
        <p className={`mt-3 rounded-lg border px-3 py-2 text-[12.5px] ${TONE_CLASS[status.tone]}`}>
          {status.text}
        </p>
        {sent && (
          <p className="mt-2 text-[12px] text-[var(--fg-4)]">
            Envoyé le lundi : {count(sent.created, 'clé créée', 'clés créées')},{' '}
            {count(sent.first_success, 'premier appel', 'premiers appels')},{' '}
            {count(sent.paid, 'paiement', 'paiements')},{' '}
            {count(sent.free_active, 'gratuit actif', 'gratuits actifs')}.
          </p>
        )}
      </section>

      <section className={overviewCard} aria-labelledby="doors-free">
        <h2 id="doors-free" className="text-sm font-semibold text-[var(--fg-1)]">
          Utilisateurs gratuits à 200 par mois
        </h2>
        <p className="mt-2 text-sm text-[var(--fg-2)]">
          <span className="text-lg font-semibold tabular-nums text-[var(--fg-1)]">{fmt(free.active)}</span>{' '}
          sur les {fmt(free.window_days)} jours du {dayMonth(free.window.from)} au {dayMonth(free.window.to)}, pour un
          seuil de réévaluation à plus de {fmt(free.threshold)} (décision du 22.09).
        </p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ink-4)]/50"
          role="img"
          aria-label={`${fmt(free.active)} sur ${fmt(free.threshold)}`}
        >
          <div
            className={`h-full rounded-full ${free.crossed ? 'bg-amber-400' : 'bg-sky-400/80'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-[12.5px] text-[var(--fg-4)]">{freeUsersCalendarLine(free)}</p>
        {free.crossed && (
          <p className={`mt-2 rounded-lg border px-3 py-2 text-[12.5px] ${TONE_CLASS.warn}`}>
            Seuil franchi : le plafond gratuit de 200 requêtes par mois est à réévaluer.
          </p>
        )}
      </section>

      <section className={overviewCard} aria-labelledby="doors-weeks">
        <h2 id="doors-weeks" className="text-sm font-semibold text-[var(--fg-1)]">
          Par semaine, toutes portes
        </h2>
        <p className="mb-2 mt-0.5 text-[12px] text-[var(--fg-4)]">
          Chaque clé compte à la semaine où la chose lui est arrivée. « +n » : relancées dont les sept jours
          courent encore.
        </p>
        <WeekTable weeks={data.weeks} totals={data.totals} />
      </section>

      <section className={overviewCard} aria-labelledby="doors-doors">
        <h2 id="doors-doors" className="text-sm font-semibold text-[var(--fg-1)]">
          Par porte, sur les {fmt(shownWeeks.length)} semaines
        </h2>
        {data.by_door.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--fg-3)]">Aucune clé externe sur ces semaines.</p>
        ) : (
          <div className="mt-2">
            <DoorTable doors={data.by_door} />
          </div>
        )}
      </section>

      {detailWeeks.length > 0 && (
        <section className={overviewCard} aria-labelledby="doors-detail">
          <h2 id="doors-detail" className="text-sm font-semibold text-[var(--fg-1)]">
            Détail par semaine et par porte
          </h2>
          <div className="mt-2 flex flex-col gap-2">
            {detailWeeks.map((w) => (
              <details key={w.key} className="rounded-lg border border-[var(--ink-4)]/50 px-3 py-2">
                <summary className="cursor-pointer text-[13px] text-[var(--fg-2)]">
                  {w.title} : {count(w.totals.created, 'créée', 'créées')},{' '}
                  {count(w.totals.first_success, 'premier appel', 'premiers appels')},{' '}
                  {count(w.totals.paid, 'paiement', 'paiements')}
                </summary>
                <div className="mt-2">
                  <DoorTable doors={w.doors} />
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      <section className={overviewCard} aria-labelledby="doors-control">
        <h2 id="doors-control" className="text-sm font-semibold text-[var(--fg-1)]">
          Contrôle
        </h2>
        <p
          className={`mt-2 rounded-lg border px-3 py-2 text-[12.5px] ${TONE_CLASS[data.control.equal ? 'ok' : 'warn']}`}
        >
          {controlLine(data.control)}
        </p>
        <details className="mt-3">
          <summary className="cursor-pointer text-[12.5px] text-[var(--fg-4)]">Définitions</summary>
          <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-[var(--fg-3)]">
            {Object.entries(data.definitions).map(([k, v]) => (
              <li key={k}>{v}</li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
}
