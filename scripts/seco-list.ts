/**
 * La liste suisse des sanctions (SECO), lue dans son export complet.
 *
 * ## Pourquoi ce fichier (07.10.2026)
 *
 * Le rafraîchissement lisait l'export de la recherche SESAM
 * (`searchSanctionWithExport.xhtml?…&action=exportXml`). Cette adresse répond
 * HTTP 500 depuis juillet : le journal du robot le montre chaque dimanche du
 * 12.07 au 04.10. Et même quand elle répondait, la base n'a plus porté une
 * seule ligne SECO depuis le passage aux sources primaires (02.06.2026) :
 * toutes les versions de `data/compliance.sqlite` depuis n'ont que l'OFAC et
 * l'UE.
 *
 * L'export complet (`downloadXmlGesamtliste.xhtml`) répond 200 : environ 42 Mo,
 * `<swiss-sanctions-list list-type="whole-list" date="…">`.
 *
 * ## Pourquoi un lecteur structuré, et non la recherche « SWIFT » sur le texte brut
 *
 * L'export complet garde l'HISTOIRE de chaque cible : les cibles radiées y
 * restent (environ 1 550 sur 8 670 le 28.09.2026), et chaque `<modification>`
 * recopie l'état avant et après dans des blocs `<added>` et `<removed>`. Lancée
 * sur le texte brut, l'extraction des autres listes ramenait, mesuré le
 * 07.10.2026 :
 * - CMSYSYDA (Commercial Bank of Syria), RADIÉE chez SECO : une fausse
 *   accusation ;
 * - INVESTME, lu dans le NOM « Swift Investments (PVT) Ltd » : un code qui passe
 *   `validateBIC` (ST est un pays) et ne désigne aucune banque ;
 * et manquait KHJBSDKH (« SWIFT/BIC code: … »), SCERIRTH et SCTSAEA1
 * (« SWIFT codes: … »).
 *
 * D'où les règles :
 * 1. seules les `<target>` de premier niveau comptent (jamais celles des blocs
 *    `<added>`/`<removed>`) ;
 * 2. une cible dont la modification la plus récente est `de-listed` est radiée
 *    et ignorée ;
 * 3. seule l'`<entity>` directe de la cible est lue (une personne ou un navire
 *    n'est pas une banque), hors des blocs `<modification>` ;
 * 4. seuls ses champs `<other-information>` sont lus, et seulement la liste de
 *    codes qui suit immédiatement le mot « SWIFT ».
 *
 * Aucune dépendance XML : le format est régulier, et une lecture par balises
 * suffit. Le fichier tient en mémoire (42 Mo).
 */

import { validateBIC } from '../src/lib/bic-validator.js';

/** L'export complet, en anglais (les champs `other-information` sont en anglais). */
export const SECO_WHOLE_LIST_URL =
  'https://www.sesam.search.admin.ch/sesam-search-web/pages/downloadXmlGesamtliste.xhtml?lang=en&action=downloadXmlGesamtlisteAction';

export interface SecoBank {
  /** Les huit caractères de l'établissement. */
  bic8: string;
  /** Le nom principal de l'entité, tel que la liste l'écrit. */
  name: string;
  /** Identifiant de la cible dans la liste (`ssid`), pour retrouver la source. */
  ssid: string;
}

export interface SecoWholeList {
  /** La date de la liste (`date` de `<swiss-sanctions-list>`), AAAA-MM-JJ. */
  listDate: string | null;
  /** Toutes les cibles de premier niveau, radiées comprises. */
  targets: number;
  /** Les cibles en vigueur : la mesure du plancher par source. */
  listedTargets: number;
  /** Les établissements en vigueur que la liste désigne par un code SWIFT, sans doublon. */
  banks: SecoBank[];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Décode les entités XML d'un texte (nommées et numériques). */
export function decodeXmlText(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(parseInt(ref.slice(1), 10));
    return ENTITIES[ref] ?? whole;
  });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeXmlText(m[1]) : null;
}

/** Le libellé « SWIFT », « SWIFT/BIC », « SWIFT/BIC code: », « SWIFT codes: », « Swift: ». */
const SWIFT_LABEL = /\bSWIFT(?:\s*\/\s*BIC)?(?:\s+codes?)?\s*:?\s*/gi;
/** Un code en capitales, éventuellement suivi d'une précision entre parenthèses. */
const LIST_ITEM = /^([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b(?:\s*\([^)]*\))?/;
/** Ce qui sépare deux codes d'une même liste. Un « ; » ferme le champ. */
const LIST_SEPARATOR = /^\s*(?:,|\/|\band\b)\s*/;

/**
 * Les codes SWIFT qu'un champ de texte annonce, dans l'ordre, sans doublon.
 *
 * Seule la liste qui suit IMMÉDIATEMENT le libellé est lue, et seulement des
 * codes écrits en capitales : « Swift Investments (PVT) Ltd » ne donne rien, ni
 * « SWIFT/BIC: CMSYSYDA, all offices worldwide » autre chose que CMSYSYDA. Un
 * code coupé par une espace (« REF AIRTH », dans l'histoire de la liste) n'est
 * pas recollé : il manque plutôt que d'être deviné.
 */
export function swiftCodesIn(text: string): string[] {
  const out: string[] = [];
  SWIFT_LABEL.lastIndex = 0;
  let label: RegExpExecArray | null;
  while ((label = SWIFT_LABEL.exec(text)) !== null) {
    let rest = text.slice(label.index + label[0].length);
    for (;;) {
      const item = LIST_ITEM.exec(rest);
      if (!item) break;
      const check = validateBIC(item[1]);
      if (check.valid && !out.includes(item[1])) out.push(item[1]);
      rest = rest.slice(item[0].length);
      const sep = LIST_SEPARATOR.exec(rest);
      if (!sep || sep[0].length === 0) break;
      rest = rest.slice(sep[0].length);
    }
  }
  return out;
}

/** Les blocs `<target>` de premier niveau, balise ouvrante comprise. */
function topLevelTargets(xml: string): Array<{ open: string; body: string }> {
  const out: Array<{ open: string; body: string }> = [];
  const tag = /<(\/?)target(?=[\s/>])([^>]*?)(\/?)>/g;
  let depth = 0;
  let open = '';
  let bodyStart = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(xml)) !== null) {
    const closing = m[1] === '/';
    const selfClosing = m[3] === '/';
    if (!closing) {
      if (depth === 0) {
        if (selfClosing) {
          out.push({ open: m[0], body: '' });
          continue;
        }
        open = m[0];
        bodyStart = m.index + m[0].length;
      }
      if (!selfClosing) depth++;
    } else {
      depth--;
      if (depth === 0) out.push({ open, body: xml.slice(bodyStart, m.index) });
      if (depth < 0) throw new Error('SECO list: unbalanced <target> tags');
    }
  }
  if (depth !== 0) throw new Error('SECO list: truncated inside a <target>');
  return out;
}

interface Modification {
  type: string;
  date: string;
  order: number;
}

const MODIFICATION = /<modification(?=[\s/>])([^>]*?)(?:\/>|>[\s\S]*?<\/modification>)/g;

/**
 * Radiée ou en vigueur : la modification la plus récente décide.
 *
 * Plus récente = la plus grande date d'effet (à défaut d'adoption, puis de
 * publication) ; à date égale ou absente, la première dans le document, qui
 * les écrit de la plus récente à la plus ancienne. Le 28.09.2026, cinq cibles
 * du programme syrien écrivent une modification du 03.06.2025 AVANT une
 * radiation du 20.06.2025 : la date l'emporte, elles sont radiées. Aucune ne
 * porte de code SWIFT.
 */
function isDelisted(mods: Modification[]): boolean {
  if (!mods.length) return false;
  const latest = mods.reduce((best, m) =>
    m.date > best.date || (m.date === best.date && m.order < best.order) ? m : best,
  );
  return latest.type === 'de-listed';
}

/**
 * Lit l'export complet de la liste SECO.
 *
 * Lève une erreur si le document n'est pas une liste complète : un export
 * partiel (une recherche, une liste de mutations) passerait sinon pour une
 * liste vidée, et le plancher par source le refuserait sans dire pourquoi.
 */
export function parseSecoWholeList(xml: string): SecoWholeList {
  const root = /<swiss-sanctions-list(?=[\s>])([^>]*)>/.exec(xml);
  if (!root) throw new Error('not a SECO sanctions list (no <swiss-sanctions-list> element)');
  const listType = attr(root[1], 'list-type');
  if (listType !== 'whole-list') {
    throw new Error(`SECO list is "${listType ?? 'untyped'}", expected the whole list`);
  }
  const listDate = attr(root[1], 'date');

  const targets = topLevelTargets(xml);
  let listedTargets = 0;
  const banks: SecoBank[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const mods: Modification[] = [];
    MODIFICATION.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = MODIFICATION.exec(target.body)) !== null) {
      mods.push({
        type: attr(mm[1], 'modification-type') ?? '',
        date:
          attr(mm[1], 'effective-date') ??
          attr(mm[1], 'enactment-date') ??
          attr(mm[1], 'publication-date') ??
          '',
        order: mods.length,
      });
    }
    if (isDelisted(mods)) continue;
    listedTargets++;

    // L'état en vigueur : le corps de la cible sans ses modifications.
    const current = target.body.replace(MODIFICATION, '');
    const entity = /<entity(?=[\s>])[^>]*>([\s\S]*?)<\/entity>/.exec(current);
    if (!entity) continue; // une personne ou un objet : jamais une banque

    const nameMatch = /<value>([^<]*)<\/value>/.exec(entity[1]);
    const name = nameMatch ? decodeXmlText(nameMatch[1]).trim() : '';
    const info = /<other-information(?=[\s>])[^>]*>([^<]*)<\/other-information>/g;
    let im: RegExpExecArray | null;
    while ((im = info.exec(entity[1])) !== null) {
      const text = decodeXmlText(im[1]);
      if (!/swift/i.test(text)) continue;
      for (const code of swiftCodesIn(text)) {
        const bic8 = code.slice(0, 8);
        if (seen.has(bic8)) continue;
        seen.add(bic8);
        banks.push({ bic8, name, ssid: attr(target.open, 'ssid') ?? '' });
      }
    }
  }

  return { listDate, targets: targets.length, listedTargets, banks };
}
