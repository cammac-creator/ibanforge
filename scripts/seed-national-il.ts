/**
 * Le registre israélien : la liste des sociétés bancaires que la Banque d'Israël
 * publie sur le portail ouvert du gouvernement (data.gov.il), complétée par sa
 * liste des agences pour les codes que la première ne porte pas.
 *
 *   SEED_FAMILY=restricted npx tsx scripts/seed-national.ts IL   # chaîne privée seulement
 *
 * ## Pourquoi par la surcouche privée (règle du 28/10/2026, case 2)
 *
 * Sur data.gov.il, les deux jeux portent la licence « autre (ouvert) », sans texte ;
 * les conditions du site de la Banque d'Israël réservent la reproduction à son accord
 * écrit. Faute d'un texte actuel qui tranche, la source est rangée en case 2 de la
 * grille (docs/data-sources.md) : servie depuis le fichier privé du serveur, source
 * citée avec le nom du jeu et sa date de mise à jour (ce que demandaient les
 * conditions du portail), retirée dans les 48 heures sur demande
 * (`RESTRICTED_WITHDRAWN=boi.org.il`). Aucune ligne n'entre dans ce dépôt : les tests
 * n'utilisent que des banques inventées.
 *
 * ## Les deux jeux
 *
 * - « List of banking corporations in Israel » (jeu 375) : un code de banque, un nom,
 *   un BIC. C'est la référence ; elle gagne toujours.
 * - « Bank branches » (jeu `branches`) : une ligne par agence, avec le code et le nom
 *   de la banque. Il ne sert qu'à NOMMER les codes que le premier jeu ne porte pas
 *   (banques d'un groupe qui gardent leur propre code, services communs), et seulement
 *   quand au moins une agence est ouverte. Il ne porte aucun BIC : ces codes sont
 *   servis avec le nom seul, `bic: null`, jamais le BIC de la banque du groupe.
 *
 * Le code de banque, ce sont les positions 5 à 7 de l'IBAN israélien (trois chiffres,
 * complétés à gauche par des zéros : 12 devient 012). Les trois suivantes sont
 * l'agence ; elles ne sont pas vérifiées ici.
 *
 * ## Le BIC, nettoyé ou écarté
 *
 * Mis en majuscules (le jeu en porte un en minuscules), gardé seulement s'il a la forme
 * d'un BIC israélien (lettres 5 et 6 = `IL`). Une succursale d'une banque étrangère
 * peut publier le BIC de sa maison mère : un IBAN israélien ne se paie pas vers lui,
 * il est donc écarté, et le chargeur le dit.
 *
 * ## Partiel
 *
 * La liste nomme les sociétés bancaires que la Banque d'Israël publie, pas
 * l'attribution de l'espace des codes : un code absent garde la réponse d'avant,
 * jamais `not_allocated` (NON_EXHAUSTIVE_REGISTERS, enrich.ts).
 */

/** L'API du portail (CKAN). Le lien CSV de la fiche redirige ailleurs : toujours l'API. */
const API = 'https://data.gov.il/api/3/action';

export const IL_DATASETS = {
  banks: {
    package: '375',
    resource: '8f994f73-45a5-4544-b808-c9ae593b0eb3',
    title: 'List of banking corporations in Israel',
  },
  branches: {
    package: 'branches',
    resource: '6f3bda2a-8cde-4b86-a1c8-2761862b1224',
    title: 'Bank branches',
  },
} as const;

/** L'éditeur que le portail doit nommer pour les deux jeux (« Banque d'Israël »). */
export const IL_PUBLISHER = 'בנק ישראל';

/** Le crédit stocké avec chaque ligne : l'éditeur, le portail, le jeu qui a nommé le code. */
export function israelSource(dataset: keyof typeof IL_DATASETS): string {
  return `Bank of Israel, ${IL_DATASETS[dataset].title} (data.gov.il)`;
}

export interface IsraelEntry {
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

/** La fiche d'un jeu : son éditeur et le jour de mise à jour de la ressource lue. */
export function parseIsraelPackage(
  body: unknown,
  dataset: keyof typeof IL_DATASETS,
): { updated: string } {
  const result = (body as { success?: boolean; result?: Record<string, unknown> })?.result;
  if (!result || (body as { success?: boolean }).success !== true)
    throw new Error(`IL: package_show ${IL_DATASETS[dataset].package} did not succeed`);
  const publisher = (result.organization as { title?: string } | undefined)?.title;
  if (publisher !== IL_PUBLISHER)
    throw new Error(
      `IL: dataset ${IL_DATASETS[dataset].package} is no longer published by the Bank of Israel`,
    );
  const resource = (result.resources as Array<Record<string, unknown>> | undefined)?.find(
    (r) => r.id === IL_DATASETS[dataset].resource,
  );
  if (!resource) throw new Error(`IL: resource ${IL_DATASETS[dataset].resource} left its dataset`);
  const stamp = String(resource.last_modified ?? resource.metadata_modified ?? '');
  const updated = /^(\d{4}-\d{2}-\d{2})T/.exec(stamp)?.[1];
  if (!updated) throw new Error(`IL: resource ${IL_DATASETS[dataset].resource} carries no date`);
  return { updated };
}

/** Un code de banque à trois chiffres, ou null s'il n'en a pas la forme. */
function bankCode(raw: unknown): string | null {
  const digits = String(raw ?? '').trim();
  if (!/^\d{1,3}$/.test(digits)) return null;
  return digits.padStart(3, '0');
}

/** Les espaces répétés du jeu réduits à un seul ; rien d'autre ne change dans un nom. */
function cleanName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ISRAELI_BIC = /^[A-Z]{4}IL[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;

/** Le BIC publié, en majuscules, s'il est israélien ; sinon null et la raison. */
export function israeliBic(raw: unknown): { bic: string | null; dropped: string | null } {
  const value = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (value === '') return { bic: null, dropped: null };
  if (ISRAELI_BIC.test(value)) return { bic: value, dropped: null };
  return {
    bic: null,
    dropped: /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(value) ? 'foreign_bic' : 'not_a_bic',
  };
}

interface DatastorePage {
  records: Array<Record<string, unknown>>;
  total: number;
}

/** Une page de `datastore_search`, contrôlée. */
export function parseDatastorePage(body: unknown, resource: string): DatastorePage {
  const ok = (body as { success?: boolean })?.success === true;
  const result = (body as { result?: { records?: unknown; total?: unknown } })?.result;
  if (!ok || !result || !Array.isArray(result.records) || typeof result.total !== 'number')
    throw new Error(`IL: datastore_search ${resource} returned an unexpected shape`);
  return { records: result.records as Array<Record<string, unknown>>, total: result.total };
}

export interface IsraelSnapshot {
  banks: Array<Record<string, unknown>>;
  banksUpdated: string;
  branches: Array<Record<string, unknown>>;
  branchesUpdated: string;
}

/**
 * Les lignes du registre, depuis les deux jeux lus. Échoue plutôt que deviner : un
 * code illisible, un code en double dans la liste des banques, un code d'agence dont
 * les agences ouvertes ne s'accordent pas sur le nom de la banque.
 */
export function buildIsraelRegister(snapshot: IsraelSnapshot): {
  entries: IsraelEntry[];
  notes: string[];
} {
  const notes: string[] = [];
  const entries: IsraelEntry[] = [];
  const seen = new Set<string>();
  for (const row of snapshot.banks) {
    const code = bankCode(row.Bank_Code);
    if (!code) throw new Error('IL: a bank row carries no readable Bank_Code');
    if (seen.has(code)) throw new Error(`IL: bank code ${code} listed twice`);
    seen.add(code);
    const name = cleanName(row.Name);
    if (!name) throw new Error(`IL: bank code ${code} has no name`);
    const { bic, dropped } = israeliBic(row.Swift_Code);
    if (dropped) notes.push(`${code}: published BIC dropped (${dropped})`);
    entries.push({
      code,
      name,
      bic,
      street: null,
      post_code: null,
      town: null,
      lei: null,
      source: israelSource('banks'),
      as_of: snapshot.banksUpdated,
    });
  }
  // Les codes que seule la liste des agences connaît : nommés si une agence au
  // moins est ouverte, et si toutes les agences ouvertes donnent le même nom.
  const open = new Map<string, Set<string>>();
  for (const row of snapshot.branches) {
    const code = bankCode(row.Bank_Code);
    if (!code) throw new Error('IL: a branch row carries no readable Bank_Code');
    if (seen.has(code)) continue;
    if (String(row.Close_Date ?? '').trim() !== '') continue;
    const name = cleanName(row.Bank_Name);
    if (!name) throw new Error(`IL: an open branch of bank code ${code} has no bank name`);
    const names = open.get(code) ?? new Set<string>();
    names.add(name);
    open.set(code, names);
  }
  for (const [code, names] of [...open].sort(([a], [b]) => a.localeCompare(b))) {
    if (names.size !== 1)
      throw new Error(`IL: open branches of bank code ${code} disagree on the bank name`);
    entries.push({
      code,
      name: [...names][0],
      bic: null,
      street: null,
      post_code: null,
      town: null,
      lei: null,
      source: israelSource('branches'),
      as_of: snapshot.branchesUpdated,
    });
    notes.push(`${code}: named from the branch list, no BIC`);
  }
  return { entries, notes };
}

export type IsraelFetch = (url: string) => Promise<unknown>;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'IBANforge register refresh (+https://ibanforge.com)' },
  });
  if (!res.ok) throw new Error(`IL: ${url} -> HTTP ${res.status}`);
  return res.json();
}

/** Toutes les lignes d'une ressource, page par page, et le contrôle du total annoncé. */
async function readAll(
  get: IsraelFetch,
  resource: string,
): Promise<Array<Record<string, unknown>>> {
  const limit = 500;
  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += limit) {
    const page = parseDatastorePage(
      await get(`${API}/datastore_search?resource_id=${resource}&limit=${limit}&offset=${offset}`),
      resource,
    );
    rows.push(...page.records);
    if (page.records.length === 0 || rows.length >= page.total) {
      if (rows.length !== page.total)
        throw new Error(`IL: ${resource} announced ${page.total} rows, ${rows.length} were read`);
      return rows;
    }
    if (offset > 20_000) throw new Error(`IL: ${resource} keeps paginating, refusing`);
  }
}

/** Le registre lu en ligne : les deux fiches, puis les deux jeux. */
export async function readIsraelLive(get: IsraelFetch = fetchJson): Promise<{
  entries: IsraelEntry[];
  notes: string[];
}> {
  const banksMeta = parseIsraelPackage(
    await get(`${API}/package_show?id=${IL_DATASETS.banks.package}`),
    'banks',
  );
  const branchesMeta = parseIsraelPackage(
    await get(`${API}/package_show?id=${IL_DATASETS.branches.package}`),
    'branches',
  );
  return buildIsraelRegister({
    banks: await readAll(get, IL_DATASETS.banks.resource),
    banksUpdated: banksMeta.updated,
    branches: await readAll(get, IL_DATASETS.branches.resource),
    branchesUpdated: branchesMeta.updated,
  });
}
