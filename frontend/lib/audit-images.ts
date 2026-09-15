import images from './audit-images.json';
import { SITE_URL, type SeoLocale } from './seo';

/** Même aperçu pour la page, le produit et les cartes de partage. */
export function auditImageFor(locale: string) {
  const known: SeoLocale = locale === 'fr' || locale === 'de' ? locale : 'en';
  const { src, width, height } = images[known];
  return { src, url: `${SITE_URL}${src}`, width, height };
}
