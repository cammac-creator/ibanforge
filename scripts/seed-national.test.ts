import { describe, it, expect } from 'vitest';
import {
  parseSanMarino,
  parseSlovakia,
  parseSlovakiaPage,
  sanMarinoSource,
  slovakSource,
} from './seed-national.js';

/**
 * The Slovak register, held by its two published shapes.
 *
 * Everything here was measured against the real files on 06/09/2026 and is
 * reproduced small enough to read. The two fixtures are not variations on a
 * theme: the CURRENT edition opens straight on an English header, while the
 * edition the dead direct link still serves opens on a Slovak TITLE row with
 * the Slovak header underneath. A parser that skips a fixed number of lines
 * passes one and eats a bank on the other.
 *
 * U+00A0 is written `\u00a0` on purpose. The register uses it inside several
 * names, and a raw non-breaking space in a fixture is an invisible character
 * that survives one careless reformat and not two.
 */

const PAGE_URL =
  'https://nbs.sk/en/payments/general-information/directories-and-registers/directory-identification-codes-domestic-payment-system-in-sr/';

/**
 * The register page, trimmed to the three things the seeder reads: the two
 * label/value pairs split by markup, and the two download anchors whose hrefs
 * are indistinguishable UUIDs. The date carries `&nbsp;` exactly as the NBS
 * writes it.
 */
const PAGE = `<h1>Directory of identification codes for the domestic payment system in Slovak Republic</h1>
<p>
    Version:
    <strong>225</strong>
</p>
<p>
    Effective from:
    <strong>18.&nbsp;5.&nbsp;2026</strong>
</p>
<ul class="documents">
  <li><a href="https://nbs.sk/dokument/53ab91a0-6cc6-4056-a17d-493dd867b28c/stiahnut/?force=true">Directory of identification codes for the domestic payment system in the Slovak Republic (PDF)</a></li>
  <li><a href="https://nbs.sk/dokument/53533909-a9c9-4727-8b89-c9fca5e214ca/stiahnut/?force=true">Directory of identification codes for the domestic payment system in the Slovak Republic (CSV)</a></li>
</ul>`;

const EDITION = { version: '225', as_of: '2026-05-18', csv_url: 'https://example.invalid/x.csv' };

/** The current file: English header, no title row. Codes without leading zeros. */
const CSV_CURRENT = [
  'Payment system code SR;Payment service provider;SWIFT 8;Payment system SIPS',
  '200;Všeobecná úverová banka, a.s.;SUBASKBX;x',
  '900;Slovenská sporiteľňa, a.s.;GIBASKBX;x',
  '720;Národná banka Slovenska;NBSBSKBX;x',
  '1100;Tatra banka, a.s.;TATRSKBX;x',
  '3000;Slovenská záručná a\u00a0rozvojová banka, a.s.;SLZBSKBA;x',
  '3100;Prima banka Slovensko, a.s. - Code for running payments ;LUBASKBX;x',
  '7500;Československá obchodná banka, a.s.;CEKOSKBX;x',
  '8191;Centrálny depozitár cenných papierov SR, a.s.;;',
  '8330;Fio banka, a.s., pobočka zahraničnej banky;FIOZSKBA;x',
  '600;MONETA Money Bank, a.s.;AGBACZPP;x',
  '3030;Air bank a.s. ;AIRACZPP;x',
  '',
].join('\r\n');

/**
 * The older file, still served by the historical direct link: a Slovak title
 * row ABOVE a Slovak header, and three banks that have since left the register.
 */
const CSV_LEGACY = [
  'Prevodník identifikačných kódov SR;;;',
  'Kód platobného styku;Poskytovateľ platobných služieb;SWIFT kód 8;Systém SIPS',
  '200;Všeobecná úverová banka, a.s.;SUBASKBX;x',
  '900;Slovenská sporiteľňa, a.s.;GIBASKBX;x',
  '5200;OTP Banka Slovensko, a.s.;OTPVSKBX;x',
  '8050;Commerzbank Aktiengesellschaft, pobočka zahraničnej banky;COBASKBX;',
  '',
].join('\r\n');

const byCode = (text: string) =>
  new Map(parseSlovakia(text, EDITION).map((e) => [e.code, e] as const));

describe('parseSlovakiaPage', () => {
  it('reads the version and the effective date through the markup and the entities', () => {
    const edition = parseSlovakiaPage(PAGE, PAGE_URL);
    expect(edition.version).toBe('225');
    // 'D. M. YYYY' with non-breaking spaces, normalised to ISO. A parser that
    // matched the raw markup would find `18.&nbsp;5.` and fail.
    expect(edition.as_of).toBe('2026-05-18');
  });

  it('picks the CSV anchor, not the PDF one', () => {
    // The only thing telling the two apart is the suffix on the anchor text:
    // both hrefs are UUIDs that change with every version.
    expect(parseSlovakiaPage(PAGE, PAGE_URL).csv_url).toBe(
      'https://nbs.sk/dokument/53533909-a9c9-4727-8b89-c9fca5e214ca/stiahnut/?force=true',
    );
  });

  it('resolves a relative href against the page', () => {
    const relative = PAGE.replace('https://nbs.sk/dokument/53533909', '/dokument/53533909');
    expect(parseSlovakiaPage(relative, PAGE_URL).csv_url).toBe(
      'https://nbs.sk/dokument/53533909-a9c9-4727-8b89-c9fca5e214ca/stiahnut/?force=true',
    );
  });

  it('refuses a page with no CSV anchor rather than falling back to the PDF', () => {
    const pdfOnly = PAGE.replace(' (CSV)', ' (XLSX)');
    expect(() => parseSlovakiaPage(pdfOnly, PAGE_URL)).toThrow(/\(CSV\)/);
  });

  it('refuses a page with no effective date instead of inventing one', () => {
    // The date is half of the attribution the NBS terms require. There is no
    // clock fallback anywhere in this path, by design.
    const undated = PAGE.replace(/Effective from:[\s\S]*?<\/p>/, '</p>');
    expect(() => parseSlovakiaPage(undated, PAGE_URL)).toThrow(/Effective from/);
  });

  it('refuses a date that does not exist on the calendar', () => {
    const impossible = PAGE.replace('18.&nbsp;5.&nbsp;2026', '31.&nbsp;2.&nbsp;2026');
    expect(() => parseSlovakiaPage(impossible, PAGE_URL)).toThrow(/not a date/);
  });
});

describe('parseSlovakia — the current English header', () => {
  it('pads the code to the four digits an IBAN carries', () => {
    const rows = byCode(CSV_CURRENT);
    // The CSV drops the leading zero; the register's own PDF and HTML table do
    // not. An unpadded '200' would deny the country's largest bank.
    expect(rows.get('0200')?.name).toBe('Všeobecná úverová banka, a.s.');
    expect(rows.get('0900')?.bic).toBe('GIBASKBX');
    expect(rows.get('0720')?.name).toBe('Národná banka Slovenska');
    expect(rows.get('0600')?.name).toBe('MONETA Money Bank, a.s.');
    expect(rows.has('200')).toBe(false);
  });

  it('keeps a Czech BIC on a Slovak code', () => {
    // Eight institutions in the register are Czech and publish a CZ BIC. A
    // country check on this column — the one seed-bg-bae.ts rightly applies to
    // Bulgaria — would drop every one of them.
    expect(byCode(CSV_CURRENT).get('0600')?.bic).toBe('AGBACZPP');
    expect(byCode(CSV_CURRENT).get('3030')?.bic).toBe('AIRACZPP');
  });

  it('stores a row whose SWIFT column is empty', () => {
    const row = byCode(CSV_CURRENT).get('8191');
    expect(row?.name).toBe('Centrálny depozitár cenných papierov SR, a.s.');
    // A real allocation that simply holds no BIC. Dropping it would turn an
    // allocated code into `not_allocated` — a denial off a coverage gap.
    expect(row?.bic).toBeNull();
  });

  it('trims the edges of a name and nothing else', () => {
    const rows = byCode(CSV_CURRENT);
    // Trailing space in the file, gone; the rest verbatim, hyphen and all.
    expect(rows.get('3100')?.name).toBe('Prima banka Slovensko, a.s. - Code for running payments');
    expect(rows.get('3030')?.name).toBe('Air bank a.s.');
    // The non-breaking space INSIDE the name survives: tidying it would be the
    // alteration the NBS terms forbid.
    expect(rows.get('3000')?.name).toBe('Slovenská záručná a\u00a0rozvojová banka, a.s.');
  });

  it('publishes no address, because the register publishes none', () => {
    const row = byCode(CSV_CURRENT).get('1100');
    expect(row?.name).toBe('Tatra banka, a.s.');
    expect([row?.street, row?.post_code, row?.town, row?.lei]).toEqual([null, null, null, null]);
  });

  it('carries the credit and the effective date on every row', () => {
    for (const row of parseSlovakia(CSV_CURRENT, EDITION)) {
      expect(row.source).toBe(
        'Národná banka Slovenska, Directory of identification codes for the domestic payment system, version 225',
      );
      expect(row.as_of).toBe('2026-05-18');
    }
  });
});

describe('parseSlovakia — the older Slovak header', () => {
  it('finds the header under a title row', () => {
    const rows = byCode(CSV_LEGACY);
    // Four data rows, not five: the title row must not be read as data, and
    // the header must not be read as a bank.
    expect(rows.size).toBe(4);
    expect(rows.get('0200')?.name).toBe('Všeobecná úverová banka, a.s.');
    expect(rows.get('5200')?.bic).toBe('OTPVSKBX');
    expect(rows.get('8050')?.bic).toBe('COBASKBX');
  });

  it('locates the BIC column by the word SWIFT, in either language', () => {
    // 'SWIFT 8' in English, 'SWIFT kód 8' in Slovak — the token is what both
    // headings share, and it is the only thing this parser matches on.
    expect(byCode(CSV_LEGACY).get('0900')?.bic).toBe('GIBASKBX');
  });
});

describe('parseSlovakia — refusals', () => {
  it('refuses a file with no SWIFT header rather than guessing at positions', () => {
    const headerless = CSV_CURRENT.split('\r\n').slice(1).join('\r\n');
    expect(() => parseSlovakia(headerless, EDITION)).toThrow(/SWIFT/);
  });

  it('refuses a file whose separator changed instead of parsing it to nothing', () => {
    // Written first as "parses to zero rows, and the floor in write() catches
    // it" — which passed, and was the wrong answer: the header still carries
    // the word SWIFT, so the column search lands on index 0, the same column
    // the code is read from. Zero rows one layer down says the download was
    // short; the truth is that the format changed, and only here can it say so.
    const commas = CSV_CURRENT.replace(/;/g, ',');
    expect(() => parseSlovakia(commas, EDITION)).toThrow(/SWIFT column/);
  });

  it('drops a row whose code is not four digits or fewer', () => {
    const bad = `${CSV_CURRENT}\r\n12345;Too long a code, a.s.;XXXXSKBX;x\r\nSUBA;Letters, a.s.;XXXXSKBX;x`;
    const rows = byCode(bad);
    expect(rows.has('12345')).toBe(false);
    expect(rows.has('SUBA')).toBe(false);
  });
});

describe('slovakSource', () => {
  it('names the authority and the version, and nothing it did not read', () => {
    expect(slovakSource({ ...EDITION, version: '226' })).toBe(
      'Národná banka Slovenska, Directory of identification codes for the domestic payment system, version 226',
    );
  });
});

/**
 * San Marino — the BCSM "operating banks" page.
 *
 * The fixture reproduces the real markup of 06/09/2026, both traps included:
 * the first bank's name split across two adjacent <strong> with NO whitespace
 * between them, and the fourth block writing "Telephone/Fax:" where the others
 * write "Phone/Fax:" while the opening label alternates between "Corporate
 * name:" and "Company name:".
 */
const SM_READ_ON = '2026-09-06';

const SM_PAGE = `<div class="pwr-rich-text">
<p>Corporate name:<br><a href="/registro-soggetti-autorizzati/5?hsLang=en" rel="noopener"><strong>Banca</strong><strong>Agricola Commerciale Istituto Bancario Sammarinese s.p.a.</strong></a><br>Registered office: Via 3 settembre, 316 - 47891 Dogana<br>Phone/Fax: 0549 871111 / 871222<br>ABI Code: 03034<br>SWIFT BIC: BASMSMSM</p>
<p>Company name:<br><a href="/registro-soggetti-autorizzati/2?hsLang=en" rel="noopener"><strong>Banca di San Marino s.p.a.</strong></a><br>Registered office: Strada della Croce, 39 - 47896 Faetano<br>Phone/Fax: 0549 873411 / 873401<br>ABI Code: 08540<br>SWIFT BIC: MAOISMSM</p>
<p>Corporate name:<br><a href="/registro-soggetti-autorizzati/3?hsLang=en" rel="noopener"><strong>Banca Sammarinese di Investimento s.p.a.</strong></a><br>Registered office: Via Monaldo da Falciano, 3 - 47891 Rovereta<br>Phone/Fax: 0549 888801 / 888802<br>ABI Code: 03287<br>SWIFT BIC: BSDISMSD</p>
<p>Company name:<br><a href="/registro-soggetti-autorizzati/48?hsLang=en" rel="noopener"><strong>Cassa di Risparmio della Repubblica di San Marino s.p.a.</strong></a><br>Registered office: P.tta del Titano, 2 - 47890 San Marino<br>Telephone/Fax: 0549 872311 / 872700<br>ABI Code: 06067<br>SWIFT BIC: CSSMSMSM</p>
<p>Some other paragraph on the page, carrying neither an ABI Code nor a BIC.</p>
</div>`;

const smByCode = (html: string) =>
  new Map(parseSanMarino(html, SM_READ_ON).map((e) => [e.code, e] as const));

describe('parseSanMarino', () => {
  it('reads the four operating banks and ignores the rest of the page', () => {
    expect([...smByCode(SM_PAGE).keys()].sort()).toEqual(['03034', '03287', '06067', '08540']);
  });

  it('un-joins a name split across two adjacent <strong>', () => {
    // 🚨 The page's own markup carries no whitespace between </strong> and
    // <strong>, so a browser renders "BancaAgricola" too. The institution's
    // real name has the space: our GLEIF-sourced directory row for BASMSMSM
    // reads "BANCA AGRICOLA COMMERCIALE ISTITUTO BANCARIO SAMMARINESE"
    // (checked 06/09/2026). Reading across an element boundary is not editing.
    expect(smByCode(SM_PAGE).get('03034')?.name).toBe(
      'Banca Agricola Commerciale Istituto Bancario Sammarinese s.p.a.',
    );
  });

  it('reads the block whose phone label differs from the other three', () => {
    // "Telephone/Fax:" on the fourth, "Phone/Fax:" on the others — proof the
    // parser anchors on ABI Code / SWIFT BIC alone.
    const row = smByCode(SM_PAGE).get('06067');
    expect(row?.name).toBe('Cassa di Risparmio della Repubblica di San Marino s.p.a.');
    expect(row?.bic).toBe('CSSMSMSM');
  });

  it('splits the registered office on the postcode, not on the comma', () => {
    // "P.tta del Titano, 2 - 47890 San Marino": a comma split would leave the
    // house number behind, and the town is two words.
    const row = smByCode(SM_PAGE).get('06067');
    expect([row?.street, row?.post_code, row?.town]).toEqual([
      'P.tta del Titano, 2',
      '47890',
      'San Marino',
    ]);
    const dogana = smByCode(SM_PAGE).get('03034');
    expect([dogana?.street, dogana?.post_code, dogana?.town]).toEqual([
      'Via 3 settembre, 316',
      '47891',
      'Dogana',
    ]);
  });

  it('publishes no LEI, because the page publishes none', () => {
    // Joining one from GLEIF here would be our enrichment wearing the BCSM's
    // credit.
    for (const row of parseSanMarino(SM_PAGE, SM_READ_ON)) expect(row.lei).toBeNull();
  });

  it('stamps every row with the day the page was read, and says so', () => {
    // The BCSM states no edition and no revision date, so the read date is the
    // only one we can stand behind — and the source string admits it.
    for (const row of parseSanMarino(SM_PAGE, SM_READ_ON)) {
      expect(row.as_of).toBe(SM_READ_ON);
      expect(row.source).toBe(sanMarinoSource());
    }
    // The name alone. Putting the date in here too printed it twice the first
    // time it was logged; the two are joined once, in nationalRegisterCredit().
    expect(sanMarinoSource()).toBe('Central Bank of the Republic of San Marino, operating banks');
  });

  it('drops a block whose ABI is not five digits', () => {
    const broken = SM_PAGE.replace('ABI Code: 03034', 'ABI Code: 0549 871111');
    const rows = smByCode(broken);
    expect(rows.has('03034')).toBe(false);
    // The other three survive: one bad block is not a reason to lose the page.
    expect(rows.size).toBe(3);
  });

  it('drops a block whose BIC is not 8 or 11 characters', () => {
    const broken = SM_PAGE.replace('SWIFT BIC: MAOISMSM', 'SWIFT BIC: n/a');
    expect(smByCode(broken).has('08540')).toBe(false);
  });

  it('parses to nothing when the labels change, so the floor refuses the write', () => {
    // A page rebuilt in Italian must not half-parse: zero blocks means write()
    // throws on MIN_EXPECTED.SM and the rows already stored stand.
    const relabelled = SM_PAGE.replace(/ABI Code:/g, 'Codice ABI:');
    expect(parseSanMarino(relabelled, SM_READ_ON)).toHaveLength(0);
  });
});
