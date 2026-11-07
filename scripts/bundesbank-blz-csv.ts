/**
 * The Bundesbank's Bankleitzahlendatei, as the public CSV: where to fetch it and
 * how to split its lines.
 *
 * Shared by seed-blz.ts (the register, into data/bic.sqlite) and
 * seed-de-pruefziffer.ts (the check-digit method of each BLZ, into
 * data/de-pruefziffer.json). This module has no side effect on import: both
 * seeders run their `main()` at top level, so neither may import the other.
 *
 * The public file carries fields 1 to 13 of the Merkblatt Bankleitzahlendatei
 * (Stand: 20. Dezember 2022, Anhang 1), in this order: Bankleitzahl, Merkmal,
 * Bezeichnung, PLZ, Ort, Kurzbezeichnung, PAN, BIC, Prüfzifferberechnungsmethode,
 * Datensatznummer, Änderungskennzeichen, Bankleitzahllöschung,
 * Nachfolge-Bankleitzahl. Field 14 (the IBAN rule) exists only in the extended
 * file, which the Bundesbank distributes through its NExt platform, not here.
 */

/**
 * The Bundesbank serves the file from a blob path that carries a content hash,
 * so the URL changes when the file does. Both known paths are tried in order;
 * enrich-bic-database.ts carries the same pair for the same reason.
 */
export const BUNDESBANK_BLZ_CSV_URLS = [
  'https://www.bundesbank.de/resource/blob/926192/d4d7565b2a5c1ad4045c0cf8e3ce1a4e/mL/blz-aktuell-csv-data.csv',
  'https://www.bundesbank.de/resource/blob/602632/8e0da085f3d1bc8adbc7a1f6c0284e1f/mL/blz-aktuell-csv-data.csv',
] as const;

/** Zero-based column of each field of the public CSV used by the seeders. */
export const BLZ_CSV_FIELD = {
  blz: 0,
  merkmal: 1,
  name: 2,
  postCode: 3,
  town: 4,
  shortName: 5,
  bic: 7,
  /** Field 9 of the Merkblatt: Kennzeichen für Prüfzifferberechnungsmethode. */
  checkMethod: 8,
  retired: 11,
  successor: 12,
} as const;

export async function downloadBundesbankBlzCsv(): Promise<string> {
  for (const url of BUNDESBANK_BLZ_CSV_URLS) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      // The file is Latin-1, not UTF-8: read bytes and decode explicitly, or
      // every umlaut in a bank name arrives mangled.
      const buf = await res.arrayBuffer();
      const text = normalizeBundesbankBlz(new TextDecoder('latin1').decode(buf));
      if (text.length > 100_000) {
        console.log(`Téléchargé : ${text.length} caractères depuis ${url}`);
        return text;
      }
    } catch (err) {
      console.warn(`  lecture refusée pour ${url}: ${String(err).slice(0, 120)}`);
    }
  }
  throw new Error('Bundesbank BLZ file could not be downloaded from any known URL');
}

/** Split one CSV line on ';' honouring the quoting the Bundesbank actually uses. */
export function splitBundesbankCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ';' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Les deux adresses peuvent servir un CSV ou les treize champs fixes (168 caractères).
 * Valider tout le document avant de le transmettre aux trois importateurs.
 */
export function normalizeBundesbankBlz(text: string): string {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length) throw new Error('Fichier Bundesbank vide');
  const widths = [8, 1, 58, 5, 35, 27, 5, 11, 2, 6, 1, 1, 8];
  const fixed = /^\d{8}[12]/.test(lines[0]);
  const header = [
    'Bankleitzahl',
    'Merkmal',
    'Bezeichnung',
    'Postleitzahl',
    'Ort',
    'Kurzbezeichnung',
    'PAN',
    'BIC',
    'Pruefziffer',
    'Datensatznummer',
    'Aenderung',
    'Loeschung',
    'Nachfolge',
  ];
  if (!fixed) {
    const h = splitBundesbankCsvLine(lines.shift()!);
    if (h.length !== 13 || !/bankleitzahl/i.test(h[0]) || h[7].toUpperCase() !== 'BIC') {
      throw new Error('En-tête Bundesbank non reconnu');
    }
  }
  if (!lines.length) throw new Error('Fichier Bundesbank sans données');
  const rows = lines.map((line, index) => {
    let fields: string[];
    if (fixed) {
      if (line.length !== 168) throw new Error(`Ligne Bundesbank ${index + 1} tronquée`);
      let offset = 0;
      fields = widths.map((width) => {
        const value = line.slice(offset, offset + width).trim();
        offset += width;
        return value;
      });
    } else fields = splitBundesbankCsvLine(line);
    if (
      fields.length !== 13 ||
      !/^\d{8}$/.test(fields[0]) ||
      !/^[12]$/.test(fields[1]) ||
      !fields[2] ||
      !/^[A-Z0-9]{2}$/.test(fields[8]) ||
      (fields[7] && !/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(fields[7]))
    ) {
      throw new Error(`Ligne Bundesbank ${index + 1} non reconnue`);
    }
    return fields.map((value) => '"' + value.replace(/"/g, '""') + '"').join(';');
  });
  return header.join(';') + '\n' + rows.join('\n') + '\n';
}
