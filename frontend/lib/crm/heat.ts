import { lastInboundNeedsNoReply } from './no-reply';
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

export interface HeatFacts {
  packs: number;
  dormant: boolean;
  atLimit: boolean;
  last7: number;
  prev7: number;
  messageCount: number;
  silenceDays: number | null;
  ballWithUs: boolean;
}

/**
 * The shared arithmetic: the Contacts list and the Clients dossiers must
 * score identically or the flame means two different things on two tabs.
 */
export function heatFromFacts(f: HeatFacts): Heat {
  const parts: HeatPart[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) parts.push({ label, points });
  };

  if (f.packs > 0) {
    add(f.packs > 1 ? `${f.packs} packs de crédits achetés` : 'A acheté un pack de crédits', 40);
    if (f.dormant) add('Payant sans appel depuis 14 j', -15);
  }
  if (f.last7 >= 500) add(`${f.last7} appels sur 7 j`, 30);
  else if (f.last7 >= 100) add(`${f.last7} appels sur 7 j`, 22);
  else if (f.last7 >= 10) add(`${f.last7} appels sur 7 j`, 14);
  else if (f.last7 > 0) add(`${f.last7} appel${f.last7 > 1 ? 's' : ''} sur 7 j`, 7);
  if (f.last7 > f.prev7 && f.prev7 > 0) add('Usage en hausse sur 7 j', 8);
  if (f.prev7 >= 10 && f.last7 === 0) add('Usage éteint cette semaine', -8);
  if (f.messageCount > 0) {
    if (f.silenceDays !== null && f.silenceDays <= 7) add('Conversation active (≤ 7 j)', 15);
    else add('Une conversation existe', 5);
    if (f.ballWithUs) add('Il attend ta réponse', 5);
    if (f.silenceDays !== null && f.silenceDays > 21) add('Silence de plus de 3 semaines', -5);
  }
  if (f.atLimit) add('Au quota ou refusé au paywall', 10);

  const raw = parts.reduce((a, p) => a + p.points, 0);
  return { score: Math.max(0, Math.min(100, raw)), parts };
}

export function heatOf(c: Contact, s: Situation | undefined): Heat {
  const b = c.business;
  return heatFromFacts({
    packs: b?.packs ?? 0,
    dormant: b?.status === 'dormant',
    atLimit: b?.status === 'at-limit',
    last7: callsIn(c, 7, 0),
    prev7: callsIn(c, 14, 7),
    messageCount: s?.messageCount ?? 0,
    silenceDays: s?.silenceDays ?? null,
    // Same question buckets.ts ballWithUs answers, and it has to be answered
    // the same way: the situation alone still says "they spoke last" about a
    // thank-you the operator has marked, so heat kept adding « Il attend ta
    // réponse » directly above a drawer band saying there was nothing to do.
    // heatFromFacts is untouched — its field already means "are they waiting on
    // us", it is this caller that was computing the fact wrong.
    ballWithUs: s?.ballInCourt === 'us' && !lastInboundNeedsNoReply(c),
  });
}

/** The list's flame: loud past 70, faint past 40, silent below. */
export function flameOf(score: number): { glyph: string; dim: boolean } | null {
  if (score >= 70) return { glyph: '🔥', dim: false };
  if (score >= 40) return { glyph: '🔥', dim: true };
  return null;
}
