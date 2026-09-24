import { langName, usableLang } from '@/lib/crm/reading';

/**
 * La pastille de langue du CRM, la même partout où une correspondance se lit :
 * « 🌐 anglais · traduit » quand on lit la traduction française, « 🌐 anglais ·
 * non traduit » (ambre) quand la traduction manque encore et que le texte
 * montré est l'original, « 🌐 français » pour un message écrit en français.
 *
 * Les couleurs sont celles que le fil de conversation portait depuis juillet :
 * le violet y avait été mesuré sur les teintes composées (voir thread.tsx), et
 * une pastille qui change de couleur d'un écran à l'autre ne dit plus la même
 * chose.
 *
 * `hideFrench` sert aux listes : sur une ligne d'aperçu, « français » répété à
 * chaque message est du bruit ; seule une langue étrangère mérite d'être dite.
 *
 * `compact` (les listes) tait aussi « · traduit » : sur un téléphone, la
 * pastille entière mangeait la ligne d'aperçu et on ne lisait plus le message
 * (constaté en recette WebKit à 390 px, 24.09.2026). Le violet suffit à dire
 * « traduit » ; « · non traduit » reste écrit, en ambre, parce que c'est une
 * alerte et qu'elle est rare.
 */
export function LangBadge({
  lang,
  translated,
  compact = false,
  hideFrench = false,
  className = '',
}: {
  lang: string | null | undefined;
  translated: boolean;
  compact?: boolean;
  hideFrench?: boolean;
  /** Marge ou alignement voulus par l'écran qui l'accueille. */
  className?: string;
}) {
  const l = usableLang(lang);
  if (!l || (hideFrench && l === 'fr')) return null;
  const pending = l !== 'fr' && !translated;
  return (
    <span
      className={[
        'inline-block shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 align-middle',
        compact ? 'text-[11px] leading-none' : 'text-[12px]',
        pending ? 'bg-amber-500/15 text-amber-300' : 'bg-violet-500/15 text-violet-300',
        className,
      ].join(' ')}
      title={
        translated
          ? 'Traduit automatiquement en français'
          : pending
            ? 'Pas encore traduit : le texte montré est l’original'
            : 'Langue détectée du message'
      }
    >
      🌐 {langName(l)}
      {translated ? (compact ? '' : ' · traduit') : pending ? ' · non traduit' : ''}
    </span>
  );
}
