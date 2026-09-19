/** Motif commun, décliné dans la couleur de chaque série. Identifiant unique par graphique. */
export function PartialDayDefs({ id, color = '#fbbf24' }: { id: string; color?: string }) {
  return <defs><pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="6" height="6" fill={color} fillOpacity={0.18} />
    <path d="M 0 0 V 6" stroke={color} strokeWidth="2.5" />
  </pattern></defs>;
}

export function partialDayProps(day: string, today: string, id: string) {
  return day === today ? { className: 'partial-day', fill: `url(#${id})` } : {};
}

export function partialDayWords(locale: string) {
  return locale === 'de' ? { tick: 'heute', note: 'Laufender Tag' }
    : locale === 'en' ? { tick: 'today', note: 'Day in progress' }
    : { tick: 'auj.', note: 'Journée en cours' };
}

/** Équivalent du motif SVG pour les petits graphiques en colonnes HTML. */
export const partialDayBackground = 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(255,255,255,.65) 3px 5px, transparent 5px 6px)';
