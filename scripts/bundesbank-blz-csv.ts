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
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) continue;
      // The file is Latin-1, not UTF-8: read bytes and decode explicitly, or
      // every umlaut in a bank name arrives mangled.
      const buf = await res.arrayBuffer();
      const text = new TextDecoder('latin1').decode(buf);
      if (text.length > 100_000) {
        console.log(`Downloaded ${text.length} chars from ${url}`);
        return text;
      }
    } catch (err) {
      console.warn(`  fetch failed for ${url}: ${String(err).slice(0, 120)}`);
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
