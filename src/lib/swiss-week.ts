/**
 * L'heure suisse et la semaine ISO suisse, côté API, sans `Intl`.
 *
 * ## Pourquoi ce module
 *
 * Le tableau des portes compte ses semaines du lundi 00:00 au dimanche 23:59,
 * HEURE SUISSE, et son résumé part le lundi matin, heure suisse. Toutes les
 * dates de la base sont en UTC (`datetime('now')`) : une semaine découpée en UTC
 * rangerait dans la mauvaise semaine chaque clé créée le lundi entre minuit et
 * une heure (deux heures l'été), et le lundi du résumé commencerait la veille.
 *
 * ## La règle, écrite une fois
 *
 * UTC+1, et UTC+2 du dernier dimanche de mars à 01:00 UTC au dernier dimanche
 * d'octobre à 01:00 UTC. C'est la règle de `frontend/lib/crm/zurich.ts`, que le
 * site applique déjà sans `Intl` : les deux doivent dire la même heure pour que
 * la page et le résumé du lundi tombent sur la même semaine.
 *
 * Aucun changement d'heure ne tombe un lundi : le passage se fait un dimanche à
 * 01:00 UTC. Le lundi 00:00 et toute heure du lundi sont donc sans ambiguïté.
 */

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Dernier dimanche d'un mois, à 01:00 UTC, en millisecondes. */
function lastSundayAtOne(year: number, month0: number): number {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0));
  const sunday = lastDay.getUTCDate() - lastDay.getUTCDay();
  return Date.UTC(year, month0, sunday, 1, 0, 0);
}

/** Décalage de l'heure suisse sur UTC, en minutes, à un instant UTC (60 ou 120). */
export function zurichOffsetMinutes(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  const start = lastSundayAtOne(year, 2);
  const end = lastSundayAtOne(year, 9);
  return utcMs >= start && utcMs < end ? 120 : 60;
}

/** Les champs de l'heure suisse à un instant UTC. `weekday` : 1 = lundi, 7 = dimanche. */
export interface ZurichParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

export function zurichParts(utcMs: number): ZurichParts {
  const local = new Date(utcMs + zurichOffsetMinutes(utcMs) * MINUTE_MS);
  const dow = local.getUTCDay();
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    weekday: dow === 0 ? 7 : dow,
  };
}

/**
 * L'instant UTC d'une heure SUISSE donnée.
 *
 * Deux essais suffisent : l'heure d'hiver d'abord, puis l'heure d'été si
 * l'instant obtenu tombe en été. Juste pour toute heure d'un lundi (voir
 * l'en-tête) ; l'heure qui n'existe pas au passage de mars n'est jamais demandée
 * ici.
 */
export function zurichLocalToUtcMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const winter = naive - 60 * MINUTE_MS;
  return zurichOffsetMinutes(winter) === 120 ? naive - 120 * MINUTE_MS : winter;
}

/** Une semaine ISO, lundi 00:00 à lundi suivant 00:00, heure suisse. */
export interface SwissWeek {
  /** `AAAA-Wss`, l'année ISO de la semaine (celle de son jeudi). */
  label: string;
  /** Le lundi, date civile suisse `AAAA-MM-JJ`. */
  monday: string;
  /** Le dimanche, date civile suisse `AAAA-MM-JJ`. */
  sunday: string;
  /** Lundi 00:00 heure suisse, en millisecondes UTC (inclus). */
  startMs: number;
  /** Lundi suivant 00:00 heure suisse, en millisecondes UTC (exclu). */
  endMs: number;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** La semaine suisse qui contient un lundi civil donné (millisecondes du lundi à 00:00 UTC). */
function weekFromCivilMonday(mondayCivilMs: number): SwissWeek {
  const thursday = new Date(mondayCivilMs + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1;
  const monday = new Date(mondayCivilMs);
  const next = new Date(mondayCivilMs + 7 * DAY_MS);
  return {
    label: `${isoYear}-W${String(week).padStart(2, '0')}`,
    monday: isoDay(mondayCivilMs),
    sunday: isoDay(mondayCivilMs + 6 * DAY_MS),
    startMs: zurichLocalToUtcMs(
      monday.getUTCFullYear(),
      monday.getUTCMonth() + 1,
      monday.getUTCDate(),
    ),
    endMs: zurichLocalToUtcMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
  };
}

/** La semaine suisse qui contient un instant UTC. */
export function swissWeekOf(utcMs: number): SwissWeek {
  const p = zurichParts(utcMs);
  const civil = Date.UTC(p.year, p.month - 1, p.day);
  return weekFromCivilMonday(civil - (p.weekday - 1) * DAY_MS);
}

/** La semaine suisse `n` semaines avant (n > 0) ou après (n < 0) celle donnée. */
export function swissWeekShift(week: SwissWeek, n: number): SwissWeek {
  const civil = Date.parse(`${week.monday}T00:00:00Z`);
  return weekFromCivilMonday(civil - n * 7 * DAY_MS);
}

/** `AAAA-MM-JJ HH:MM:SS` UTC, le format de `datetime('now')`. */
export function sqliteUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Un horodatage de la base en millisecondes UTC, ou null.
 *
 * La base écrit `AAAA-MM-JJ HH:MM:SS` sans fuseau, et c'est de l'UTC. Quelques
 * colonnes plus anciennes portent l'ISO 8601 complet : les deux formes sont
 * lues comme de l'UTC, jamais comme une heure locale.
 */
export function parseDbUtc(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw.trim());
  if (!m) {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    return day ? Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : null;
  }
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  );
}

/** `JJ.MM` d'une date civile `AAAA-MM-JJ`, la forme des dates du tableau de bord. */
export function dayMonth(civil: string): string {
  return `${civil.slice(8, 10)}.${civil.slice(5, 7)}`;
}

/** `JJ.MM à HH:MM` en heure suisse, pour un instant UTC. */
export function zurichDayTime(utcMs: number): string {
  const p = zurichParts(utcMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.day)}.${pad(p.month)} à ${pad(p.hour)}:${pad(p.minute)}`;
}
