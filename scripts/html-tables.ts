/**
 * Lecture minimale des tableaux HTML des pages officielles (Finantsinspektsioon,
 * Eesti Pangaliit, Banque centrale du Monténégro), sans dépendance.
 *
 * Ces pages sont écrites à la main dans un éditeur de contenu : une cellule porte
 * un ou plusieurs paragraphes (`<p>96</p><p>17</p>`), un lien enveloppé dans un
 * `<span>`, des `&nbsp;` de remplissage, des lignes vides. La lecture garde donc,
 * pour chaque cellule, la LISTE de ses lignes de texte, et laisse l'appelant
 * décider si elles se joignent (un nom) ou se séparent (deux codes).
 *
 * Un tableau imbriqué dans un autre est refusé : la page a changé de forme, et un
 * humain doit la relire.
 */

export interface HtmlRow {
  /** La ligne ne porte que des cellules d'en-tête (`<th>`). */
  header: boolean;
  /** Pour chaque cellule, ses lignes de texte non vides. */
  cells: string[][];
}

export interface HtmlTable {
  rows: HtmlRow[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Une suite d'espaces, insécables comprises (`\s` les connaît), devient une espace simple. */
function squeeze(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Le texte sans balises. Une seule passe peut laisser une balise entière derrière
 * une balise imbriquée (`<<b>script>` rend `script>`, mais `<<script>script>` aurait
 * pu rendre `<script`) : on repasse jusqu'à ce que plus rien ne change, puis on
 * retire les chevrons isolés qui restent. Le texte n'est jamais rendu en HTML ici,
 * il sert à lire un tableau ; la précaution évite quand même qu'une page piégée
 * glisse une balise dans un fichier du dépôt.
 */
function stripTags(html: string): string {
  let text = html;
  for (;;) {
    const next = text.replace(/<[^>]*>/g, '');
    if (next === text) break;
    text = next;
  }
  return text.replace(/[<>]/g, '');
}

/** Les lignes de texte d'une cellule : un paragraphe, un saut ou un item par ligne. */
export function cellLines(cellHtml: string): string[] {
  return stripTags(cellHtml.replace(/<\/(p|div|li)>|<br\s*\/?>/gi, '\n'))
    .split('\n')
    .map((line) => squeeze(decodeEntities(line)))
    .filter((line) => line !== '');
}

export function parseHtmlTables(html: string): HtmlTable[] {
  const tables: HtmlTable[] = [];
  for (const match of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const body = match[1]!;
    if (/<table\b/i.test(body)) throw new Error('Tableau imbriqué : la page a changé de forme');
    const rows: HtmlRow[] = [];
    for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1]!.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
      if (cells.length === 0) continue;
      rows.push({
        header: cells.every((cell) => cell[1]!.toLowerCase() === 'th'),
        cells: cells.map((cell) => cellLines(cell[2]!)),
      });
    }
    tables.push({ rows });
  }
  return tables;
}

/** Une cellule en un seul texte (les lignes jointes par une espace). */
export function cellText(cell: readonly string[] | undefined): string {
  return (cell ?? []).join(' ');
}
