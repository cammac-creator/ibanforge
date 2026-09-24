import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  czechNumberedCsvUrl,
  czechSource,
  ensureNationalTables,
  parseCzech,
  parseCzechEditions,
  planCzechEditions,
  writeCzech,
  type CzechEdition,
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
 * The fixture reproduces the STRUCTURE of the page as read on 06/09/2026, with
 * invented banks, codes, addresses and numbers (25/09/2026: the BCSM publishes
 * no terms of use, so its content does not belong in a public repository, not
 * even as a test fixture). Both traps of the real markup are kept: the first
 * bank's name split across two adjacent <strong> with NO whitespace between
 * them, and the fourth block writing "Telephone/Fax:" where the others write
 * "Phone/Fax:" while the opening label alternates between "Corporate name:"
 * and "Company name:".
 */
const SM_READ_ON = '2026-01-15';

const SM_PAGE = `<div class="pwr-rich-text">
<p>Corporate name:<br><a href="/registro-soggetti-autorizzati/91?hsLang=en" rel="noopener"><strong>Banca</strong><strong>Fantasia per Prove e Collaudi s.p.a.</strong></a><br>Registered office: Via dell'Esempio, 101 - 47891 Contrada<br>Phone/Fax: 0549 000001 / 000002<br>ABI Code: 09991<br>SWIFT BIC: XMPLSMSM</p>
<p>Company name:<br><a href="/registro-soggetti-autorizzati/92?hsLang=en" rel="noopener"><strong>Banca di Prova s.p.a.</strong></a><br>Registered office: Strada della Prova, 22 - 47896 Borghetto<br>Phone/Fax: 0549 000003 / 000004<br>ABI Code: 09994<br>SWIFT BIC: XMPLSMS2</p>
<p>Corporate name:<br><a href="/registro-soggetti-autorizzati/93?hsLang=en" rel="noopener"><strong>Istituto Fittizio di Collaudo s.p.a.</strong></a><br>Registered office: Via Immaginaria, 3 - 47891 Contrada<br>Phone/Fax: 0549 000005 / 000006<br>ABI Code: 09992<br>SWIFT BIC: XMPLSMSMAAA</p>
<p>Company name:<br><a href="/registro-soggetti-autorizzati/94?hsLang=en" rel="noopener"><strong>Cassa Immaginaria di Collaudo s.p.a.</strong></a><br>Registered office: P.tta dell'Esempio, 2 - 47890 Borgo Esempio<br>Telephone/Fax: 0549 000007 / 000008<br>ABI Code: 09993<br>SWIFT BIC: XMPLSMS3</p>
<p>Some other paragraph on the page, carrying neither an ABI Code nor a BIC.</p>
</div>`;

const smByCode = (html: string) =>
  new Map(parseSanMarino(html, SM_READ_ON).map((e) => [e.code, e] as const));

describe('parseSanMarino', () => {
  it('reads the four operating banks and ignores the rest of the page', () => {
    expect([...smByCode(SM_PAGE).keys()].sort()).toEqual(['09991', '09992', '09993', '09994']);
  });

  it('un-joins a name split across two adjacent <strong>', () => {
    // 🚨 The page's own markup carries no whitespace between </strong> and
    // <strong>, so a browser renders the two words glued together too. The
    // institution's real name has the space (the bank's GLEIF-sourced row in
    // our directory carries it, checked 06/09/2026 on the real page's first
    // bank). Reading across an element boundary is not editing.
    expect(smByCode(SM_PAGE).get('09991')?.name).toBe('Banca Fantasia per Prove e Collaudi s.p.a.');
  });

  it('reads the block whose phone label differs from the other three', () => {
    // "Telephone/Fax:" on the fourth, "Phone/Fax:" on the others — proof the
    // parser anchors on ABI Code / SWIFT BIC alone.
    const row = smByCode(SM_PAGE).get('09993');
    expect(row?.name).toBe('Cassa Immaginaria di Collaudo s.p.a.');
    expect(row?.bic).toBe('XMPLSMS3');
  });

  it('splits the registered office on the postcode, not on the comma', () => {
    // "P.tta dell'Esempio, 2 - 47890 Borgo Esempio": a comma split would leave
    // the house number behind, and the town is two words.
    const row = smByCode(SM_PAGE).get('09993');
    expect([row?.street, row?.post_code, row?.town]).toEqual([
      "P.tta dell'Esempio, 2",
      '47890',
      'Borgo Esempio',
    ]);
    const first = smByCode(SM_PAGE).get('09991');
    expect([first?.street, first?.post_code, first?.town]).toEqual([
      "Via dell'Esempio, 101",
      '47891',
      'Contrada',
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
    const broken = SM_PAGE.replace('ABI Code: 09991', 'ABI Code: 0549 000001');
    const rows = smByCode(broken);
    expect(rows.has('09991')).toBe(false);
    // The other three survive: one bad block is not a reason to lose the page.
    expect(rows.size).toBe(3);
  });

  it('drops a block whose BIC is not 8 or 11 characters', () => {
    const broken = SM_PAGE.replace('SWIFT BIC: XMPLSMS2', 'SWIFT BIC: n/a');
    expect(smByCode(broken).has('09994')).toBe(false);
  });

  it('parses to nothing when the labels change, so the floor refuses the write', () => {
    // A page rebuilt in Italian must not half-parse: zero blocks means write()
    // throws on MIN_EXPECTED.SM and the rows already stored stand.
    const relabelled = SM_PAGE.replace(/ABI Code:/g, 'Codice ABI:');
    expect(parseSanMarino(relabelled, SM_READ_ON)).toHaveLength(0);
  });
});

/**
 * Czechia — the ČNB číselník.
 *
 * The fixtures reproduce the real markup and file of 25/09/2026, trimmed: the
 * current page's nested list with its commented-out copy pointing at the ČNB's
 * administration server (given ANOTHER number here, so that reading it would
 * show), the history page's one-anchor items, and the CSV with its CRLF, its
 * empty BIC cells, the trailing space of some CERTIS cells and no line ending
 * after the last row.
 */
const CZ_PAGE_URL = 'https://www.cnb.cz/cs/platebni-styk/ucty-kody-bank/';
const CZ_HISTORY_URL = 'https://www.cnb.cz/cs/platebni-styk/ucty-kody-bank/historicke-ciselniky/';

const CZ_PAGE = `<head><link rel="stylesheet" href="/x.css"><title>Číselníky, seznamy, registry - Česká národní banka</title></head>
<div class="headline"><h2 >Číselník kódů platebního styku v České republice</h2></div>
<ul>
<li>Aktuální Číselník kódů platebního styku v ČR
<ul>
<li>Číselník 254 <a href="/export/sites/cnb/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR.pdf">platný od 1. 9. 2026 (pdf, 186 kB)</a>, <a href="/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR.csv">(utf-8, csv, 3 kB)</a></li>
</ul>
</li>
<li><a href="/export/sites/cnb/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR_zmeny.pdf">Historie změn číselníku od 1. 3. 2009 (pdf, 581 kB)</a></li>
<li><a href="/cs/platebni-styk/ucty-kody-bank/historicke-ciselniky/">Historické číselníky</a></li>
</ul>
<!--
			<li>Číselník 999 <a href="https://admin-cnb.cz.net/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR_999.pdf">platný od 1. 1. 2027 (pdf, 186 kB)</a>, <a href="https://admin-cnb.cz.net/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR_999.csv">(utf-8, csv, 3 kB)</a></li>
-->
<ul><li><a href="/export/sites/cnb/cs/platebni-styk/.galleries/ucty_kody_bank/download/seznam_platsys_ucast_cr.pdf">verze 116 platná od 1. 9. 2026 (pdf, 129 kB)</a></li></ul>`;

const CZ_HISTORY = `<ul>
<li><a href="/export/sites/cnb/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR_254.pdf">Číselník 254 platný od 1. 9. 2026 (pdf, 186 kB)</a></li>
<li><a href="/export/sites/cnb/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR_253.pdf">Číselník 253 platný od 1. 7. 2026 (pdf, 192 kB)</a></li>
<li><a href="/export/sites/cnb/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR_251.pdf">Číselník 251 platný od 16. 3. 2026 (pdf, 272 kB)</a></li>
<li><a href="/export/sites/cnb/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR_248.pdf">Číselník 248 platný od 1. 10. 2025 (pdf, 268 kB)</a></li>
<li><a href="/export/sites/cnb/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR_247.pdf">Číselník 247 platný od 1. 10. 2025 (pdf, 267 kB)</a></li>
</ul>`;

const CZ_EDITION: CzechEdition = { version: '254', as_of: '2026-09-01', csv_url: null };

const CZ_CSV = [
  '\uFEFFKód platebního styku;Poskytovatel platebních služeb;BIC kód (SWIFT);Systém CERTIS',
  '0100;Komerční banka, a.s.;KOMBCZPP;A',
  '0800;Česká spořitelna, a.s.;GIBACZPX;A',
  '2600;Citibank Europe plc, organizační složka;CITICZPX;A ',
  '6600;Banking Circle S.A., Czech Republic;;-',
  '7990;Modrá pyramida stavební spořitelna, a.s.;;A',
  '8660;PAYMONT, UAB;;A',
].join('\r\n');

const czByCode = (text: string) =>
  new Map(parseCzech(text, CZ_EDITION).map((e) => [e.code, e] as const));

describe('parseCzechEditions', () => {
  it('reads the number, the date and the linked CSV of the current page', () => {
    expect(parseCzechEditions(CZ_PAGE, CZ_PAGE_URL)).toEqual([
      {
        version: '254',
        as_of: '2026-09-01',
        csv_url:
          'https://www.cnb.cz/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR.csv',
      },
    ]);
  });

  it('ignores the commented-out copy that points at the administration server', () => {
    const editions = parseCzechEditions(CZ_PAGE, CZ_PAGE_URL);
    expect(editions.map((e) => e.version)).not.toContain('999');
    expect(JSON.stringify(editions)).not.toContain('admin-cnb');
  });

  it('reads the history page, where the whole phrase sits in one anchor and no CSV is linked', () => {
    const editions = parseCzechEditions(CZ_HISTORY, CZ_HISTORY_URL);
    expect(editions.map((e) => [e.version, e.as_of, e.csv_url])).toEqual([
      ['254', '2026-09-01', null],
      ['253', '2026-07-01', null],
      ['251', '2026-03-16', null],
      ['248', '2025-10-01', null],
      ['247', '2025-10-01', null],
    ]);
  });

  it('refuses a date that does not exist on the calendar', () => {
    const impossible = CZ_PAGE.replace('platný od 1. 9. 2026', 'platný od 31. 2. 2026');
    expect(() => parseCzechEditions(impossible, CZ_PAGE_URL)).toThrow(/not a date/);
  });

  it('finds nothing on a page that changed shape, rather than something wrong', () => {
    expect(parseCzechEditions(CZ_PAGE.replace(/Číselník 254/, 'Verze 254'), CZ_PAGE_URL)).toEqual(
      [],
    );
  });
});

describe('planCzechEditions', () => {
  const page = (version: string, as_of: string): CzechEdition => ({
    version,
    as_of,
    csv_url:
      'https://www.cnb.cz/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR.csv',
  });
  const history = parseCzechEditions(CZ_HISTORY, CZ_HISTORY_URL);

  it('puts the current edition in force when its date has come', () => {
    const plan = planCzechEditions([page('254', '2026-09-01')], '2026-09-25');
    expect(plan.current.version).toBe('254');
    expect(plan.pending).toBeNull();
  });

  it('keeps the edition in force and announces the next one while its date is to come', () => {
    // The window 8190 fell into: 254 on the server from 24 August, in force
    // from 1 September. Loading it on the 24th must not refuse 8190 for a week.
    const plan = planCzechEditions(
      [page('254', '2026-09-01'), ...history.filter((e) => e.version !== '254')],
      '2026-08-24',
    );
    expect(plan.current.version).toBe('253');
    expect(plan.pending?.version).toBe('254');
    // The announced edition keeps the CSV the current page links.
    expect(plan.pending?.csv_url).toMatch(/kody_bank_CR\.csv$/);
  });

  it('switches on an effective date that is not the 1st', () => {
    const plan = planCzechEditions(history, '2026-03-15');
    expect(plan.current.version).toBe('248');
    // The NEXT edition to take effect, not the highest number announced: with
    // 253 and 254 also ahead, 251 is the one that must apply on 16 March.
    expect(plan.pending?.version).toBe('251');
    expect(planCzechEditions(history, '2026-03-16').current.version).toBe('251');
  });

  it('takes the highest number in force, not the one before the announced edition', () => {
    // 247 and 248 took effect on the same day.
    expect(planCzechEditions(history, '2025-10-05').current.version).toBe('248');
  });

  it('refuses an edition dated differently on the two pages', () => {
    expect(() => planCzechEditions([page('254', '2026-09-02'), ...history], '2026-09-25')).toThrow(
      /dated/,
    );
  });

  it('refuses when no edition it can see is in force yet', () => {
    expect(() => planCzechEditions([page('255', '2026-10-01')], '2026-09-25')).toThrow(/in force/);
  });
});

describe('parseCzech', () => {
  it('reads codes, names and BICs as the ČNB writes them', () => {
    const rows = czByCode(CZ_CSV);
    expect(rows.size).toBe(6);
    expect(rows.get('0100')).toMatchObject({ name: 'Komerční banka, a.s.', bic: 'KOMBCZPP' });
    expect(rows.get('0800')).toMatchObject({ name: 'Česká spořitelna, a.s.', bic: 'GIBACZPX' });
    expect(rows.get('2600')?.bic).toBe('CITICZPX');
  });

  it('removes the byte-order mark some editions open with', () => {
    // 253 has one, 254 has none: with it, the header search fails.
    expect(czByCode(CZ_CSV).size).toBe(czByCode(CZ_CSV.replace('\uFEFF', '')).size);
  });

  it('keeps a code the ČNB publishes without a BIC', () => {
    const rows = czByCode(CZ_CSV);
    // Real allocations: a payment institution, a building society, the last
    // row (no line ending after it). Dropping them would refuse them.
    expect(rows.get('6600')).toMatchObject({
      name: 'Banking Circle S.A., Czech Republic',
      bic: null,
    });
    expect(rows.get('7990')?.bic).toBeNull();
    expect(rows.get('8660')?.name).toBe('PAYMONT, UAB');
  });

  it('carries the credit, the edition and its date on every row, and no address', () => {
    for (const row of parseCzech(CZ_CSV, CZ_EDITION)) {
      expect(row.source).toBe('Zdroj: ČNB, Číselník kódů platebního styku v ČR, verze 254');
      expect(row.as_of).toBe('2026-09-01');
      expect([row.street, row.post_code, row.town, row.lei]).toEqual([null, null, null, null]);
    }
  });

  it('refuses an HTML page served in place of the file', () => {
    // The server labels the real CSV text/html, so the type proves nothing;
    // the header row is what does.
    expect(() => parseCzech('<!DOCTYPE html><html><body>404</body></html>', CZ_EDITION)).toThrow(
      /Kód platebního styku/,
    );
  });

  it('refuses a file whose separator changed', () => {
    expect(() => parseCzech(CZ_CSV.replace(/;/g, ','), CZ_EDITION)).toThrow(/BIC column/);
  });
});

describe('czechSource and the numbered file', () => {
  it('opens on the words the ČNB terms prescribe, with the edition', () => {
    expect(czechSource({ version: '255' })).toBe(
      'Zdroj: ČNB, Číselník kódů platebního styku v ČR, verze 255',
    );
  });

  it('names the numbered CSV of an edition', () => {
    expect(czechNumberedCsvUrl('254')).toBe(
      'https://www.cnb.cz/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR_254.csv',
    );
  });
});

describe('writeCzech', () => {
  /** An edition of `n` invented codes, above the floor. */
  const edition = (version: string, as_of: string, n = 40) => {
    const ed: CzechEdition = { version, as_of, csv_url: null };
    const text = [
      'Kód platebního styku;Poskytovatel platebních služeb;BIC kód (SWIFT);Systém CERTIS',
      ...Array.from({ length: n }, (_, i) => `${String(1000 + i)};Příkladová banka ${i}, a.s.;;A`),
    ].join('\r\n');
    return { edition: ed, entries: parseCzech(text, ed) };
  };
  const fresh = () => {
    const db = new Database(':memory:');
    ensureNationalTables(db);
    return db;
  };
  const count = (db: Database.Database, table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE country = 'CZ'`).get() as { n: number })
      .n;
  const versionIn = (db: Database.Database, table: string) =>
    (
      db.prepare(`SELECT source FROM ${table} WHERE country = 'CZ' LIMIT 1`).get() as
        { source: string } | undefined
    )?.source;

  it('writes the edition in force and the announced one side by side', () => {
    const db = fresh();
    writeCzech(db, edition('253', '2026-07-01'), edition('254', '2026-09-01', 39));
    expect(count(db, 'national_bank_codes')).toBe(40);
    expect(count(db, 'national_bank_codes_pending')).toBe(39);
    expect(versionIn(db, 'national_bank_codes')).toMatch(/verze 253$/);
    expect(versionIn(db, 'national_bank_codes_pending')).toMatch(/verze 254$/);
  });

  it('clears the announcement once a newer edition is in force', () => {
    const db = fresh();
    writeCzech(db, edition('253', '2026-07-01'), edition('254', '2026-09-01'));
    writeCzech(db, edition('254', '2026-09-01'), null);
    expect(versionIn(db, 'national_bank_codes')).toMatch(/verze 254$/);
    expect(count(db, 'national_bank_codes_pending')).toBe(0);
  });

  it('refuses to go back an edition, and leaves both tables as they were', () => {
    const db = fresh();
    writeCzech(db, edition('254', '2026-09-01'), edition('255', '2026-10-01'));
    expect(() => writeCzech(db, edition('253', '2026-07-01'), null)).toThrow(/go back/);
    expect(versionIn(db, 'national_bank_codes')).toMatch(/verze 254$/);
    expect(versionIn(db, 'national_bank_codes_pending')).toMatch(/verze 255$/);
  });

  it('refuses a short edition before touching anything', () => {
    const db = fresh();
    writeCzech(db, edition('253', '2026-07-01'), null);
    expect(() => writeCzech(db, edition('254', '2026-09-01', 10), null)).toThrow(/at least/);
    expect(versionIn(db, 'national_bank_codes')).toMatch(/verze 253$/);
  });

  it('leaves the other countries of the table alone', () => {
    const db = fresh();
    db.prepare(
      `INSERT INTO national_bank_codes (country, code, name) VALUES ('SK', '0200', 'Všeobecná úverová banka, a.s.')`,
    ).run();
    writeCzech(db, edition('254', '2026-09-01'), null);
    expect(
      (
        db.prepare(`SELECT COUNT(*) AS n FROM national_bank_codes WHERE country = 'SK'`).get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
  });
});
