import { toZurich } from '@/lib/crm/zurich';

export interface ViewTimestamp { epoch: number; iso: string; date: string; time: string }
export type ViewAge = { kind: 'unknown' | 'future' | 'now' | 'minutes' | 'hours' | 'days'; value: number; stale: boolean };

/** Une heure sans fuseau ou une date impossible ne deviennent pas une date locale implicite. */
export function readViewTimestamp(value: string): ViewTimestamp | null {
  const match = /^([1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const wall = Date.parse(`${match[1]}Z`), epoch = Date.parse(value);
  if (!Number.isFinite(wall) || !Number.isFinite(epoch) || new Date(wall).toISOString().slice(0, 19) !== match[1]) return null;
  const iso = new Date(epoch).toISOString(), swiss = toZurich(iso);
  return { epoch, iso, date: `${swiss.slice(8, 10)}.${swiss.slice(5, 7)}.${swiss.slice(0, 4)}`, time: swiss.slice(11, 16) };
}

/** L’âge décrit la vue affichée ; aucune requête réseau ne dépend de ce calcul. */
export function readViewAge(epoch: number | null, now: number): ViewAge {
  if (epoch === null || !Number.isFinite(epoch) || !Number.isFinite(now)) return { kind: 'unknown', value: 0, stale: true };
  const delta = now - epoch;
  if (delta < -60_000) return { kind: 'future', value: 0, stale: true };
  const minutes = Math.max(0, Math.floor(delta / 60_000));
  if (minutes < 1) return { kind: 'now', value: 0, stale: false };
  if (minutes < 60) return { kind: 'minutes', value: minutes, stale: minutes >= 15 };
  if (minutes < 1440) return { kind: 'hours', value: Math.floor(minutes / 60), stale: true };
  return { kind: 'days', value: Math.floor(minutes / 1440), stale: true };
}
