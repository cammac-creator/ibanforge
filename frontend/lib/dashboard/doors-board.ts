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

/**
 * Les utilisateurs gratuits actifs à 200 par mois. Le seuil de 50 compte des
 * PERSONNES (adresses distinctes) ; le nombre de clés est donné à côté.
 */
export interface FreeUsers {
  threshold: number;
  threshold_counts: 'people';
  window_days: number;
  window: { from: string; to: string };
  active_people: number;
  active_keys: number;
  calendar: Array<{ month: string; people: number; keys: number; to_date: boolean }>;
  crossed_by: Array<{ basis: 'window' | 'month'; month: string | null; people: number }>;
  crossed: boolean;
}

export interface LastWeek {
  week: string;
  title: string;
  monday: string;
  sunday: string;
  numbers: {
    created: number;
    first_success: number;
    paid: number;
    /** En personnes : le nombre que lit le seuil. */
    free_active: number;
    free_active_keys: number;
  };
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
    free_active_keys: number;
  } | null;
}

export interface DigestState {
  enabled: boolean;
  blocked: ChannelBlock | null;
  window: { first: string; last: string; deadline: string };
  /** Le lundi de la semaine en cours, et s'il a passé son heure limite (17:00). */
  this_monday: { week: string; monday: string; deadline_passed: boolean };
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

/** Un nombre et son nom accordé : 0 et 1 au singulier, comme en français. */
export function count(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n <= 1 ? one : many}`;
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
  if (reason.startsWith('telegram_refused')) return 'Telegram a refusé le message';
  if (reason === 'send_unconfirmed') {
    return 'Telegram n’a pas confirmé l’envoi (coupure ou délai dépassé) et le message a pu partir : pas de second essai';
  }
  if (reason === 'process_stopped_mid_send') return 'le serveur a redémarré pendant l’envoi';
  return reason;
}

export type Tone = 'ok' | 'wait' | 'warn' | 'neutral';

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
    // Aucune ligne pour ce lundi alors que son heure limite est passée : l'API
    // ne tournait pas ce lundi-là, et ce résumé ne partira jamais. Le dire, au
    // lieu d'annoncer un « prochain résumé » (relecture du 25.09.2026, D7).
    if (digest.this_monday.deadline_passed) {
      return {
        tone: 'warn',
        text: `Résumé de ce lundi ${dayMonth(digest.this_monday.monday)} pas parti : l’API ne tournait pas ce lundi.`,
      };
    }
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
          text: `${when} ; depuis, la page a bougé : passage en payant, remboursement, ferme regroupée ou données arrivées en retard.`,
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
        : { tone: 'wait', text: `Résumé prévu ce lundi ${latest.next_attempt_at} (heure suisse).` };
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

/** Le mois civil de la définition du 22.09, en personnes, avec les clés à côté. */
export function freeUsersCalendarLine(free: FreeUsers): string {
  const parts = free.calendar.map(
    (m) =>
      `${count(m.people, 'personne', 'personnes')} (${count(m.keys, 'clé', 'clés')}) en ${monthName(m.month)}${m.to_date ? ' à ce jour' : ''}`,
  );
  return `Au mois civil, définition du 22.09 : ${parts.join(', ')}.`;
}

/**
 * La cohérence interne du tableau, en une phrase. Ce n'est PAS une preuve :
 * les deux nombres sont comptés par la même règle, donc égaux par construction
 * tant que le rangement ne perd ni ne double aucune clé (relecture du
 * 25.09.2026, D4). La preuve que la règle est juste vient du recoupement
 * indépendant, joué sur la production.
 */
export function controlLine(control: DoorBoardControl): string {
  const created = fmt(control.created_total);
  const fleet = fmt(control.external_fleet);
  if (control.equal) {
    return `La colonne « créées », toutes semaines et toutes portes, fait ${created}, comme le parc externe compté par la même règle : le tableau ne perd ni ne double aucune clé.`;
  }
  const gap = Math.abs(control.gap);
  return `La colonne « créées » fait ${created}, le parc externe compté par la même règle ${fleet} : le tableau perd ou double ${count(gap, 'clé', 'clés')}, à regarder.`;
}
