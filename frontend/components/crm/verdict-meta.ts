import type { Nuance, Verdict } from '@/lib/crm/client-dossiers';
import type { BusinessStatus } from '@/lib/crm/types';

/**
 * The state vocabulary, in gravity order: what needs doing first, then what is
 * merely true.
 *
 * These are the API's OWN six words (src/lib/activation.ts), not a second table
 * computed here. That is the whole of the fix for audit findings TABS-01 and
 * TABS-09, 2026-09-01: "endormi" used to name three people on Contacts and
 * nineteen on Clients, because each page decided the word for itself. One
 * table, one rule, one count.
 */
export const STATES: Array<{ key: BusinessStatus; label: string; one: string; colour: string; why: string }> = [
  { key: 'at-limit', label: 'À la limite', one: 'À la limite', colour: 'var(--err)', why: 'ils tapent leur plafond' },
  { key: 'paying', label: 'Payants', one: 'Payant', colour: 'var(--ok)', why: 'ils ont acheté des crédits et appellent' },
  { key: 'dormant', label: 'Endormis', one: 'Endormi', colour: 'var(--warn)', why: 'acheteurs sans appel depuis plus de 14 jours' },
  { key: 'active', label: 'Actifs', one: 'Actif', colour: 'var(--info)', why: 'ils appellent, sans avoir acheté' },
  { key: 'new', label: 'Nouveaux', one: 'Nouveau', colour: 'var(--violet, #a78bfa)', why: 'inscrits tout récemment' },
  { key: 'silent', label: 'Muets', one: 'Muet', colour: 'var(--fg-5)', why: 'une clé, aucun appel' },
];

export const STATE_BY_KEY = Object.fromEntries(STATES.map((s) => [s.key, s])) as Record<
  BusinessStatus,
  (typeof STATES)[number]
>;

/**
 * The four precisions the API's word cannot carry, shown in SECOND position
 * behind it and never instead of it.
 *
 * Each says something the activation table does not know: that a silence is
 * that of a customer we used to have, that somebody is being turned away, that
 * their calls are mostly rejected, that their volume is climbing. None of them
 * is a state word, so none can contradict the one beside it.
 */
export const NUANCES: Array<{ key: Nuance; label: string; one: string; colour: string; why: string }> = [
  { key: 'blocked', label: 'Bloqués', one: 'bloqué', colour: 'var(--err)', why: 'le dernier échange a été un refus, et rien depuis' },
  { key: 'struggling', label: 'En difficulté', one: 'en difficulté', colour: 'var(--warn)', why: 'plus de 30 % de leurs appels sont rejetés' },
  { key: 'former', label: 'Anciens', one: 'ancien', colour: 'var(--violet, #a78bfa)', why: 'ont réellement appelé par le passé, plus rien sur la fenêtre affichée' },
  { key: 'rising', label: 'En hausse', one: 'en hausse', colour: 'var(--ok)', why: 'volume en nette hausse sur 7 jours' },
];

export const NUANCE_BY_KEY = Object.fromEntries(NUANCES.map((n) => [n.key, n])) as Record<
  Nuance,
  (typeof NUANCES)[number]
>;

/**
 * The window verdict's own words, kept for the one place that still names a
 * verdict directly: the sort by gravity, which orders on `d.verdict`.
 *
 * No longer the state vocabulary. Two consumers read this table before
 * 2026-09-01 and both now read STATES; what is left here is the ordering, and
 * the colour a derived word borrows when the activation table knows nothing
 * about an address.
 */
export const VERDICT_BY_KEY: Record<Verdict, { one: string; colour: string; why: string }> = {
  blocked: NUANCE_BY_KEY.blocked,
  struggling: NUANCE_BY_KEY.struggling,
  former: NUANCE_BY_KEY.former,
  rising: NUANCE_BY_KEY.rising,
  active: STATE_BY_KEY.active,
  dormant: STATE_BY_KEY.dormant,
  silent: STATE_BY_KEY.silent,
};
