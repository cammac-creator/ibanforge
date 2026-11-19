import { nationalRegisterEdition } from './national-registers.js';
import { ilMnRegisterName } from './il-mn-credit.js';
import { ruRegisterName } from './ru-credit.js';
import { dkRegisterName } from './dk-credit.js';
import { trRegisterName } from './tr-credit.js';

/**
 * The "Data sources and attribution" lines of the API's /llms.txt for the partial
 * lists served from the private overlay: Israel and Mongolia (28/10/2026), Russia
 * (28/10/2026), Denmark, the Faroe Islands and Greenland (18/11/2026) and Türkiye
 * (18/11/2026).
 *
 * ## Why this file exists
 *
 * The "country by country" block of /llms.txt named these lists, but the sources
 * section credited none of their publishers (review of 19/11/2026): the Greek,
 * Estonian, Montenegrin and Serbian lists had a line there, the later ones never
 * got theirs.
 *
 * Each line is built from the credit every answer already carries
 * (`bank_code_check.register`, src/lib/il-mn-credit.ts, ru-credit.ts, dk-credit.ts,
 * tr-credit.ts), with the source and the date read from the rows of the edition in
 * force. Like the San Marino and Italian lines beside it, a line is present only
 * when its rows are loaded: no credit naming a list this deployment does not
 * serve, and no date it does not hold.
 */

type Edition = { source: string | null; as_of: string | null };

interface PartialList {
  /** How the sources section names the data, like "Greek bank codes". */
  label: string;
  /** The countries the list answers for; the first one loaded gives the edition. */
  countries: readonly string[];
  /** The credit and the reserve, as `bank_code_check.register` prints them. */
  credit: (source: string, asOf: string) => string;
}

const PARTIAL_LISTS: readonly PartialList[] = [
  {
    label: 'Israeli bank codes',
    countries: ['IL'],
    credit: (source, asOf) => ilMnRegisterName('IL', source, asOf),
  },
  {
    label: 'Mongolian bank codes',
    countries: ['MN'],
    credit: (source, asOf) => ilMnRegisterName('MN', source, asOf),
  },
  { label: 'Russian bank codes', countries: ['RU'], credit: ruRegisterName },
  {
    // One list for three IBAN countries: one line, as on every other surface.
    label: 'Danish, Faroese and Greenlandic bank codes',
    countries: ['DK', 'FO', 'GL'],
    credit: dkRegisterName,
  },
  { label: 'Turkish bank codes', countries: ['TR'], credit: trRegisterName },
];

/** The countries this file credits, for the test. */
export const PARTIAL_LIST_COUNTRIES: readonly string[] = PARTIAL_LISTS.flatMap((l) => l.countries);

/**
 * One "- <label>: <credit>" line per list whose rows are loaded, in a fixed order.
 * `edition` is the reader of the edition in force; tests pass their own.
 */
export function partialListSourceLines(
  edition: (cc: string) => Edition = nationalRegisterEdition,
): string[] {
  const lines: string[] = [];
  for (const list of PARTIAL_LISTS) {
    for (const cc of list.countries) {
      const { source, as_of } = edition(cc);
      if (source && as_of) {
        lines.push(`- ${list.label}: ${list.credit(source, as_of)}`);
        break;
      }
    }
  }
  return lines;
}
