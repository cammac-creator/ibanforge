// Seules les pages publiques du parcours de documentation sont concernées.
// Les routes API, comptes, téléchargements et autres chemins restent intacts.
const PUBLIC_CONTENT_PATH = /^\/(?:docs|blog|pricing|playground|audit|vendors|tools|compare|alternatives|agents|status|iid|blz)(?:\/|$)/;

export function localizeContentHref(href: string | undefined, locale: string): string | undefined {
  if (!href || (locale !== 'fr' && locale !== 'de') || !href.startsWith('/') || href.startsWith('//')) {
    return href;
  }

  const boundary = href.search(/[?#]/);
  const pathname = boundary === -1 ? href : href.slice(0, boundary);
  const suffix = boundary === -1 ? '' : href.slice(boundary);

  // Une langue écrite dans le contenu exprime un choix à respecter. Une URL
  // de fichier ou dont le chemin doit être décodé n'est pas une page reconnue.
  if (/^\/(?:fr|en|de)(?:\/|$)/.test(pathname)
      || pathname.includes('%')
      || pathname.includes('\\')
      || /\.[^/]+\/?$/.test(pathname)
      || /(?:^|\/)\.{1,2}(?:\/|$)/.test(pathname)) {
    return href;
  }

  if (pathname !== '/' && !PUBLIC_CONTENT_PATH.test(pathname)) return href;
  return `/${locale}${pathname === '/' ? '' : pathname}${suffix}`;
}
