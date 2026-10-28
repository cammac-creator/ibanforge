/**
 * Le registre russe : le répertoire des BIK du système de paiement de la Banque de
 * Russie (« Справочник БИК », message ED807), publié chaque jour ouvrable en archive
 * ZIP derrière https://www.cbr.ru/s/newbik.
 *
 *   SEED_FAMILY=restricted npx tsx scripts/seed-national.ts RU   # chaîne privée seulement
 *
 * Étages (DONNEES-ETAGES) : lit la source (l'archive du jour, jamais écrite sur
 * disque), écrit l'argent (les lignes nommées de `national_bank_codes` et les liens
 * de `ru_branch_heads`) dans la base que la chaîne privée construit.
 *
 * ## Pourquoi par la surcouche privée (décision du 28/10/2026, « Nommer seulement »)
 *
 * Les conditions du site de la Banque de Russie permettent la reproduction sans
 * restriction, à la seule condition de citer la source (case 1 de la grille,
 * docs/data-sources.md). Claude-Alain a choisi de NOMMER les établissements russes
 * et de dire si la conformité les trouve sur une liste de sanctions, rien de plus.
 * Par prudence pour un pays sous sanctions, les lignes passent tout de même par le
 * fichier privé du serveur : retirées en minutes (`RESTRICTED_WITHDRAWN=cbr.ru`),
 * jamais dans ce dépôt, un paquet ou un export. Les tests n'utilisent que des
 * établissements inventés.
 *
 * ## Le code, et pourquoi c'est celui de l'IBAN
 *
 * L'IBAN russe porte le BIK aux positions 5 à 13 (neuf chiffres, BBAN_STRUCTURE de
 * iban-core) : c'est l'attribut `BIC` de chaque `BICDirectoryEntry`, le code
 * national et non un BIC SWIFT.
 *
 * ## Ce qui est servi
 *
 * - Les établissements de crédit (PtType 20) et leurs succursales (PtType 30), actifs
 *   (`ParticipantStatus` PSAC) et sans restriction de participation (`RstrList`) :
 *   une banque dont la participation est restreinte ou en liquidation n'est pas
 *   nommée comme une banque qui reçoit des virements. Les autres participants
 *   (divisions de la Banque de Russie, Trésor, administrateurs de liquidation,
 *   clients) sont écartés et comptés.
 * - Le nom `NameP`, en cyrillique, tel que publié ; aucune adresse (« nommer
 *   seulement »).
 * - Le BIC SWIFT que le répertoire marque par défaut (`DefaultSWBIC="1"`), tel que
 *   publié (8 ou 11 caractères), seulement s'il est russe et bien formé ; sinon
 *   `bic: null`. Jamais celui du siège prêté à une succursale.
 *
 * ## Le lien des succursales (table `ru_branch_heads`)
 *
 * Chaque succursale désigne son siège (`PrntBIC`, même licence). Le lien n'est pas
 * servi comme un fait de la réponse : il sert la conformité, qui contrôle sur les
 * listes de sanctions tous les BIC SWIFT de l'établissement (siège et succursales,
 * une seule personne morale), et non le seul BIC de la ligne
 * (src/lib/ru-institution.ts).
 *
 * ## Partiel
 *
 * Le filtre ci-dessus laisse des BIK attribués hors de la table : un code absent garde
 * la réponse d'avant, jamais `not_allocated` (NON_EXHAUSTIVE_REGISTERS, enrich.ts).
 */
import { inflateRawSync } from 'node:zlib';
import { readZipEntries } from './seed-eba-psd.js';
import { RU_SOURCE } from '../src/lib/ru-credit.js';

/** L'adresse stable de l'archive du jour (elle redirige vers le fichier). */
export const RU_DIRECTORY_URL = 'https://www.cbr.ru/s/newbik';

/** Établissement de crédit, succursale : les deux types servis. */
const HEAD_OFFICE = '20';
const BRANCH = '30';

const BIK = /^\d{9}$/;
/** Un BIC SWIFT russe, à 8 ou 11 caractères. */
const RUSSIAN_BIC = /^[A-Z]{4}RU[A-Z0-9]{2}([A-Z0-9]{3})?$/;

export interface RussiaEntry {
  code: string;
  name: string;
  bic: string | null;
  street: null;
  post_code: null;
  town: null;
  lei: null;
  source: string;
  as_of: string;
}

/** Une succursale et le BIK de son siège. */
export interface RussiaBranch {
  code: string;
  head: string;
  source: string;
  as_of: string;
}

export interface RussiaRegister {
  entries: RussiaEntry[];
  branches: RussiaBranch[];
  notes: string[];
}

const ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const n =
        ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    const named = ENTITIES[ref.toLowerCase()];
    if (named === undefined) throw new Error(`RU: unknown XML entity ${whole}`);
    return named;
  });
}

/**
 * Les attributs d'une balise, entre guillemets doubles comme l'ED807 les écrit. Un
 * reste qui ne se lit pas comme un attribut est un format changé : Error.
 */
export function readAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const rest = raw
    .replace(/([A-Za-z_][\w.:-]*)="([^"]*)"/g, (_whole, name: string, value: string) => {
      if (name in attrs) throw new Error(`RU: attribute ${name} written twice`);
      attrs[name] = decodeEntities(value);
      return '';
    })
    .replace(/\/\s*$/, '');
  if (rest.trim() !== '') throw new Error('RU: a tag carries text that is not an attribute');
  return attrs;
}

/** Les balises `<tag …>` ou `<tag …/>` d'un fragment, leurs attributs seulement. */
function tags(fragment: string, tag: string): Array<Record<string, string>> {
  return [...fragment.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))].map((m) =>
    readAttributes(m[1]),
  );
}

/** 'AAAA-MM-JJ' si le calendrier connaît ce jour, null sinon. */
function realDate(iso: string | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const probe = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== iso ? null : iso;
}

export interface Ed807Participant {
  bik: string;
  name: string;
  type: string;
  status: string;
  parent: string | null;
  restrictions: string[];
  swift: Array<{ bic: string; isDefault: boolean }>;
}

/**
 * Le répertoire, depuis le texte XML déjà décodé. Échoue plutôt que deviner : racine
 * ou espace de noms inattendus, jour ouvrable absent, entrée sans `ParticipantInfo`
 * ou sans BIK à neuf chiffres, BIK en double, entrées comptées deux façons qui ne
 * s'accordent pas.
 */
export function parseEd807(xml: string): { businessDay: string; participants: Ed807Participant[] } {
  const root = /<ED807\b([^>]*)>/.exec(xml);
  if (!root) throw new Error('RU: no ED807 root element, format changed');
  const rootAttrs = readAttributes(root[1]);
  if (!rootAttrs.xmlns?.startsWith('urn:cbr-ru:ed:'))
    throw new Error(`RU: unexpected ED807 namespace ${rootAttrs.xmlns ?? '(none)'}`);
  const businessDay = realDate(rootAttrs.BusinessDay);
  if (!businessDay) throw new Error('RU: the directory states no business day');
  const opened = xml.match(/<BICDirectoryEntry\b/g)?.length ?? 0;
  const participants: Ed807Participant[] = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<BICDirectoryEntry\b([^>]*)>([\s\S]*?)<\/BICDirectoryEntry>/g)) {
    const bik = readAttributes(m[1]).BIC ?? '';
    if (!BIK.test(bik)) throw new Error(`RU: an entry carries "${bik}", not a nine-digit BIK`);
    if (seen.has(bik)) throw new Error(`RU: BIK ${bik} listed twice`);
    seen.add(bik);
    const info = tags(m[2], 'ParticipantInfo');
    if (info.length !== 1) throw new Error(`RU: BIK ${bik} has ${info.length} ParticipantInfo`);
    const p = info[0];
    participants.push({
      bik,
      name: (p.NameP ?? '').trim(),
      type: p.PtType ?? '',
      status: p.ParticipantStatus ?? '',
      parent: p.PrntBIC ?? null,
      restrictions: tags(m[2], 'RstrList').map((r) => r.Rstr ?? '?'),
      swift: tags(m[2], 'SWBICS').map((s) => ({
        bic: (s.SWBIC ?? '').trim().toUpperCase(),
        isDefault: s.DefaultSWBIC === '1',
      })),
    });
  }
  if (participants.length !== opened)
    throw new Error(`RU: ${opened} entries opened, ${participants.length} read; format changed`);
  if (participants.length === 0) throw new Error('RU: the directory lists no participant');
  return { businessDay, participants };
}

/** Les lignes servies et les liens des succursales, avec ce qui a été écarté. */
export function buildRussiaRegister(directory: {
  businessDay: string;
  participants: Ed807Participant[];
}): RussiaRegister {
  const notes: string[] = [];
  const asOf = directory.businessDay;
  const kept = new Map<string, Ed807Participant>();
  let otherTypes = 0;
  for (const p of directory.participants) {
    if (p.type !== HEAD_OFFICE && p.type !== BRANCH) {
      otherTypes++;
      continue;
    }
    if (p.status !== 'PSAC') {
      notes.push(`${p.bik}: participant status ${p.status || '(none)'}, left out`);
      continue;
    }
    if (p.restrictions.length > 0) {
      notes.push(`${p.bik}: participation restricted (${p.restrictions.join(', ')}), left out`);
      continue;
    }
    if (!p.name) throw new Error(`RU: BIK ${p.bik} has no name`);
    kept.set(p.bik, p);
  }
  notes.push(
    `${otherTypes} participants that are neither credit institutions nor branches, left out`,
  );

  const entries: RussiaEntry[] = [];
  const branches: RussiaBranch[] = [];
  for (const p of kept.values()) {
    const defaults = p.swift.filter((s) => s.isDefault);
    if (defaults.length > 1) throw new Error(`RU: BIK ${p.bik} marks several default SWIFT BICs`);
    let bic: string | null = defaults[0]?.bic ?? null;
    if (bic && !RUSSIAN_BIC.test(bic)) {
      notes.push(`${p.bik}: default SWIFT BIC ${bic} is not a Russian BIC, not served`);
      bic = null;
    }
    if (!bic && p.swift.length > 0 && defaults.length === 0)
      notes.push(`${p.bik}: SWIFT BICs without a default, none served`);
    entries.push({
      code: p.bik,
      name: p.name,
      bic,
      street: null,
      post_code: null,
      town: null,
      lei: null,
      source: RU_SOURCE,
      as_of: asOf,
    });
    if (p.type === BRANCH) {
      const head = p.parent ? kept.get(p.parent) : undefined;
      if (head?.type === HEAD_OFFICE) {
        branches.push({ code: p.bik, head: head.bik, source: RU_SOURCE, as_of: asOf });
      } else {
        notes.push(`${p.bik}: branch whose head office ${p.parent ?? '(none)'} is not served`);
      }
    }
  }
  return { entries, branches, notes };
}

/**
 * Le texte XML de l'archive : un seul fichier `AAAAMMJJ_ED807_full.xml`, décodé selon
 * l'encodage que son prologue déclare (windows-1251 aujourd'hui).
 */
export function readEd807Zip(zip: Buffer): string {
  if (zip.subarray(0, 4).toString('latin1') !== 'PK\u0003\u0004')
    throw new Error('RU: cbr.ru did not serve a ZIP archive (an anti-bot page?)');
  const files = readZipEntries(zip).filter((e) => /\.xml$/i.test(e.name));
  if (files.length !== 1 || !/^\d{8}_ED807_full\.xml$/i.test(files[0].name))
    throw new Error(
      `RU: the archive holds ${files.map((f) => f.name).join(', ') || 'no XML'}, expected one ED807 file`,
    );
  const entry = files[0];
  let raw: Buffer;
  if (entry.method === 8) raw = inflateRawSync(entry.compressed);
  else if (entry.method === 0) raw = Buffer.from(entry.compressed);
  else throw new Error(`RU: ZIP method ${entry.method}, expected deflate`);
  const prolog = /^<\?xml[^>]*encoding="([^"]+)"/i.exec(raw.subarray(0, 200).toString('latin1'));
  const encoding = (prolog?.[1] ?? 'utf-8').toLowerCase();
  if (encoding !== 'windows-1251' && encoding !== 'utf-8')
    throw new Error(`RU: unexpected XML encoding ${encoding}`);
  return new TextDecoder(encoding).decode(raw);
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`RU: ${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Le répertoire lu en ligne : l'archive du jour, le XML, les lignes servies. */
export async function readRussiaLive(
  get: (url: string) => Promise<Buffer> = fetchBuffer,
): Promise<RussiaRegister> {
  return buildRussiaRegister(parseEd807(readEd807Zip(await get(RU_DIRECTORY_URL))));
}
