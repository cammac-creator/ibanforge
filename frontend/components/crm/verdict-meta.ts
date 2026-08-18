import type { Verdict } from '@/lib/crm/client-dossiers';

/**
 * The verdict vocabulary, in gravity order: what needs doing first, then what
 * is merely true. `blocked` leads because it is the only one that describes a
 * customer we are actively losing. Shared by the Clients table (header filter)
 * and the dossier modal (state banner) so the two never disagree on a word or
 * a colour.
 */
export const VERDICTS: Array<{ key: Verdict; label: string; one: string; colour: string; why: string }> = [
  { key: 'blocked', label: 'Bloqués', one: 'Bloqué', colour: 'var(--err)', why: 'le dernier échange a été un refus, et rien depuis' },
  { key: 'struggling', label: 'En difficulté', one: 'En difficulté', colour: 'var(--warn)', why: 'plus de 30 % de leurs appels sont rejetés' },
  { key: 'rising', label: 'En montée', one: 'En montée', colour: 'var(--ok)', why: 'volume en nette hausse sur 7 jours' },
  { key: 'active', label: 'Actifs', one: 'Actif', colour: 'var(--info)', why: 'appellent régulièrement' },
  { key: 'dormant', label: 'Dormants', one: 'Dormant', colour: 'var(--fg-4)', why: 'plus rien depuis plus de 14 jours' },
  { key: 'former', label: 'Anciens', one: 'Ancien client', colour: 'var(--violet, #a78bfa)', why: 'ont réellement appelé par le passé, plus rien sur la fenêtre affichée' },
  { key: 'silent', label: 'Muets', one: 'Muet', colour: 'var(--fg-5)', why: 'une clé, jamais utilisée' },
];

export const VERDICT_BY_KEY = Object.fromEntries(VERDICTS.map((v) => [v.key, v])) as Record<
  Verdict,
  (typeof VERDICTS)[number]
>;
