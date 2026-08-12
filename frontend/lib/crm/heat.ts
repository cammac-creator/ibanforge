import type { Contact, Situation } from './types';

/**
 * The heat score: one 0–100 number that ranks who deserves attention first,
 * computed from facts the CRM already holds — never guessed, and never a
 * black box. Every point added or removed is returned as a named part, so
 * the dossier can print the arithmetic and the operator can disagree with a
 * specific line rather than with a mystery.
 *
 * The weights are deliberately coarse (a pack outweighs everything, a live
 * conversation beats raw call volume). They rank, they do not measure: the
 * only consumer is an ordering and a flame glyph.
 */

export interface HeatPart {
  label: string;
  points: number;
}

export interface Heat {
  score: number;
  parts: HeatPart[];
}

/** Sum of per-day call counts over the window [from, to) days ago. */
function callsIn(c: Contact, fromDaysAgo: number, toDaysAgo: number): number {
  if (c.kind !== 'client') return 0;
  const from = new Date(Date.now() - fromDaysAgo * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() - toDaysAgo * 86_400_000).toISOString().slice(0, 10);
  return c.usage.days.reduce((a, d) => (d.day >= from && d.day < to ? a + d.count : a), 0);
}

export function heatOf(c: Contact, s: Situation | undefined): Heat {
  const parts: HeatPart[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) parts.push({ label, points });
  };

  const b = c.business;
  if (b && b.packs > 0) {
    add(b.packs > 1 ? `${b.packs} packs de crédits achetés` : 'A acheté un pack de crédits', 40);
    if (b.status === 'dormant') add('Payant sans appel depuis 14 j', -15);
  }

  // Recent API activity, from the per-day series the dossier chart reads.
  const last7 = callsIn(c, 7, 0);
  if (last7 >= 500) add(`${last7} appels sur 7 j`, 30);
  else if (last7 >= 100) add(`${last7} appels sur 7 j`, 22);
  else if (last7 >= 10) add(`${last7} appels sur 7 j`, 14);
  else if (last7 > 0) add(`${last7} appel${last7 > 1 ? 's' : ''} sur 7 j`, 7);

  const prev7 = callsIn(c, 14, 7);
  if (last7 > prev7 && prev7 > 0) add('Usage en hausse sur 7 j', 8);
  if (prev7 >= 10 && last7 === 0) add('Usage éteint cette semaine', -8);

  // The conversation, from the same situation the band reads.
  if (s && s.messageCount > 0) {
    if (s.silenceDays !== null && s.silenceDays <= 7) add('Conversation active (≤ 7 j)', 15);
    else add('Une conversation existe', 5);
    if (s.ballInCourt === 'us') add('Il attend ta réponse', 5);
    if (s.silenceDays !== null && s.silenceDays > 21) add('Silence de plus de 3 semaines', -5);
  }

  // The wall is the conversion moment: someone at their limit is deciding.
  if (b && b.status === 'at-limit') add('Au quota ou refusé au paywall', 10);

  const raw = parts.reduce((a, p) => a + p.points, 0);
  return { score: Math.max(0, Math.min(100, raw)), parts };
}

/** The list's flame: loud past 70, faint past 40, silent below. */
export function flameOf(score: number): { glyph: string; dim: boolean } | null {
  if (score >= 70) return { glyph: '🔥', dim: false };
  if (score >= 40) return { glyph: '🔥', dim: true };
  return null;
}
