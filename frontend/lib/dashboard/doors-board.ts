/**
 * Le tableau des portes du lundi, côté site : la forme que rend
 * `GET /v1/admin/doors`, et les phrases que la page en tire.
 *
 * Les nombres ne sont JAMAIS recalculés ici : la page affiche ceux de l'API,
 * calculés par la même fonction que le résumé Telegram du lundi
 * (`src/lib/door-board.ts`). Ce module ne fait que dire, en français, ce que
 * ces nombres et l'état de l'envoi veulent dire. Aucun `Intl` : les nombres
 * passent par `format-grouped`, les dates arrivent déjà en heure suisse.
 */
import { formatGrouped } from '@/lib/format-grouped';

export interface DoorCounts {
  created: number;
  first_success: number;
  nudged: number;
  called_after_nudge: number;
  followup_pending: number;
  paid: number;
}

export interface DoorRow extends DoorCounts {
  door: string;
  label: string;
}

export interface WeekRow {
  key: string;
  kind: 'current' | 'complete' | 'before' | 'undated';
  title: string;
  monday: string | null;
  sunday: string | null;
  totals: DoorCounts;
  doors: DoorRow[];
}

export interface FreeUsers {
  threshold: number;
  window_days: number;
  window: { from: string; to: string };
  active: number;
  calendar: Array<{ month: string; active: number; to_date: boolean }>;
  crossed_by: Array<{ basis: 'window' | 'month'; month: string | null; active: number }>;
  crossed: boolean;
}

export interface LastWeek {
  week: string;
  title: string;
  monday: string;
  sunday: string;
  numbers: { created: number; first_success: number; paid: number; free_active: number };
  nudged: number;
  called_after_nudge: number;
  followup_pending: number;
  top_doors: Array<{ door: string; label: string; created: number }>;
  sentence: string;
}

export interface DoorBoardControl {
  created_total: number;
  external_fleet: number;
  equal: boolean;
  gap: number;
  external_key_rows: number;
}

export type ChannelBlock = 'kill_switch' | 'ops_alerts_disabled' | 'telegram_not_configured';

export interface DigestView {
  week: string;
  summary_week: string;
  status: 'planned' | 'sending' | 'sent' | 'failed' | 'interrupted' | 'missed' | 'skipped';
  attempts: number;
  planned_at: string;
  next_attempt_at: string;
  departed_at: string | null;
  sent_at: string | null;
  skip_reason: string | null;
  last_error: string | null;
  numbers: {
    week: string;
    created: number;
    first_success: number;
    paid: number;
    free_active: number;
  } | null;
}

export interface DigestState {
  enabled: boolean;
  blocked: ChannelBlock | null;
  window: { first: string; last: string; deadline: string };
  recent: DigestView[];
  latest_matches_page: boolean | null;
}

export interface DoorsPayload {
  observed_at: string;
  observed_at_zurich: string;
  weeks_shown: number;
  weeks: WeekRow[];
  by_door: DoorRow[];
  totals: DoorCounts;
  control: DoorBoardControl;
  free_users: FreeUsers;
  last_week: LastWeek;
  definitions: Record<string, string>;
  digest: DigestState;
}

/** Un nombre de clés, groupé à la française, le même au serveur et dans le navigateur. */
export function fmt(n: number): string {
  return formatGrouped(n, 'fr');
}

/** `JJ.MM` d'une date civile `AAAA-MM-JJ`. */
export function dayMonth(civil: string): string {
  return `${civil.slice(8, 10)}.${civil.slice(5, 7)}`;
}

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export function monthName(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

/** Le libellé court d'une ligne de semaine : « S40 », avec son lundi à côté. */
export function weekShort(row: WeekRow): { label: string; detail: string | null } {
  if (row.kind === 'before' || row.kind === 'undated') return { label: row.title, detail: null };
  const number = row.key.slice(-2).replace(/^0/, '');
  const range = row.monday && row.sunday ? `${dayMonth(row.monday)} au ${dayMonth(row.sunday)}` : null;
  return {
    label: `S${number}${row.kind === 'current' ? ', en cours' : ''}`,
    detail: range,
  };
}

const BLOCKS: Record<ChannelBlock, string> = {
  kill_switch: 'l’interrupteur du résumé est coupé',
  ops_alerts_disabled: 'les alertes d’exploitation sont coupées',
  telegram_not_configured: 'Telegram n’est pas configuré sur l’API',
};

function reasonText(reason: string | null): string {
  if (!reason) return 'raison inconnue';
  if (reason in BLOCKS) return BLOCKS[reason as ChannelBlock];
  if (reason === 'telegram_refused') return 'Telegram a refusé le message';
  if (reason === 'send_timeout_ambiguous') {
    return 'Telegram n’a pas répondu à temps, et le message a pu partir : pas de second essai';
  }
  if (reason === 'process_stopped_mid_send') return 'le serveur a redémarré pendant l’envoi';
  return reason;
}

export type Tone = 'ok' | 'wait' | 'warn';

/**
 * Où en est le résumé du lundi qui porte sur la semaine passée, en une phrase.
 * Le lundi d'envoi n'a de ligne qu'à partir de son premier battement : avant,
 * la page annonce la fenêtre, pas une minute qu'elle ne connaît pas encore.
 */
export function digestStatus(digest: DigestState, lastWeek: LastWeek): { tone: Tone; text: string } {
  if (!digest.enabled) {
    return { tone: 'warn', text: 'Résumé du lundi éteint : il ne part plus.' };
  }
  const latest = digest.recent.find((r) => r.summary_week === lastWeek.week);
  if (!latest) {
    if (digest.blocked) {
      return {
        tone: 'warn',
        text: `Le prochain résumé du lundi ne pourra pas partir : ${reasonText(digest.blocked)}.`,
      };
    }
    return {
      tone: 'wait',
      text: `Prochain résumé : lundi, à une minute tirée au hasard entre ${digest.window.first} et ${digest.window.last}, heure suisse.`,
    };
  }
  switch (latest.status) {
    case 'sent': {
      const when = `Résumé envoyé le lundi ${latest.departed_at ?? latest.sent_at ?? ''} (heure suisse)`;
      if (digest.latest_matches_page === true) {
        return { tone: 'ok', text: `${when}, avec les mêmes nombres que ci-dessus.` };
      }
      if (digest.latest_matches_page === false) {
        return {
          tone: 'warn',
          text: `${when} ; depuis, des données sont arrivées en retard et la page a bougé.`,
        };
      }
      return { tone: 'ok', text: `${when}.` };
    }
    case 'planned':
      return latest.skip_reason
        ? {
            tone: 'warn',
            text: `Résumé prévu ce lundi, bloqué pour l’instant : ${reasonText(latest.skip_reason)}.`,
          }
        : { tone: 'wait', text: `Résumé prévu ce lundi à ${latest.next_attempt_at} (heure suisse).` };
    case 'sending':
      return { tone: 'wait', text: 'Résumé en cours d’envoi.' };
    case 'failed':
      return { tone: 'warn', text: `Résumé pas envoyé ce lundi : ${reasonText(latest.last_error)}.` };
    case 'interrupted':
      return {
        tone: 'warn',
        text: 'Résumé interrompu ce lundi : le serveur a redémarré pendant l’envoi, et il n’est pas renvoyé.',
      };
    case 'missed':
      return {
        tone: 'warn',
        text: 'Résumé pas parti ce lundi : l’API ne tournait pas avant 17:00, heure suisse.',
      };
    case 'skipped':
      return { tone: 'warn', text: `Résumé sauté ce lundi : ${reasonText(latest.skip_reason)}.` };
  }
}

/** Les nombres effectivement envoyés, quand ils diffèrent de ceux de la page. */
export function sentNumbersIfDifferent(
  digest: DigestState,
  lastWeek: LastWeek,
): DigestView['numbers'] {
  if (digest.latest_matches_page !== false) return null;
  const latest = digest.recent.find(
    (r) => r.summary_week === lastWeek.week && r.status === 'sent',
  );
  return latest?.numbers ?? null;
}

/** La ligne du seuil : le nombre du lundi, puis le mois civil de la définition du 22.09. */
export function freeUsersCalendarLine(free: FreeUsers): string {
  const parts = free.calendar.map(
    (m) => `${fmt(m.active)} en ${monthName(m.month)}${m.to_date ? ' à ce jour' : ''}`,
  );
  return `Au mois civil, définition du 22.09 : ${parts.join(', ')}.`;
}

/** Le contrôle du parc, en une phrase. */
export function controlLine(control: DoorBoardControl): string {
  const head = `Colonne « créées », toutes semaines et toutes portes : ${fmt(control.created_total)}. Parc externe du jour, compté à part : ${fmt(control.external_fleet)}.`;
  if (control.equal) return `${head} Égal.`;
  const gap = Math.abs(control.gap);
  return `${head} Écart de ${fmt(gap)} ${gap === 1 ? 'clé' : 'clés'}, à regarder.`;
}
