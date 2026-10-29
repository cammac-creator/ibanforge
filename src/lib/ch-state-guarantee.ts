/**
 * IBANforge — the state guarantee of the 24 Swiss cantonal banks, read in the
 * cantonal laws that create (or created) each bank.
 *
 * ## What it says, and what it does not
 *
 * `guaranteed: true` means the cantonal law makes the canton liable for the
 * bank's liabilities when the bank's own funds fall short (Staatsgarantie,
 * garantie de l'État, garanzia dello Stato). It describes the institution, the
 * same way `payment_services.sic` does. It is not an assessment of the bank, of
 * the canton or of any account, and it plays no part in a score: it is served
 * by `lookup_ch_clearing` only, never by `validate_iban`, whose result
 * `check_compliance` copies whole (src/lib/compliance-response.ts), so that a
 * compliance answer cannot read it as a signal.
 *
 * The exclusions each law writes (subordinated debt, participation capital,
 * subsidiaries) are not turned into categories: the article cited carries
 * them. Obwalden and Glarus add a default condition ("und die Bank nicht in der
 * Lage ist, ihren fälligen Verpflichtungen / Verbindlichkeiten nachzukommen");
 * their guarantee is still in the law, and the article reference is the answer.
 *
 * ## Matched by the head-office IID, not by the name
 *
 * Names mislead here: the domain aikb.ch belongs to the cantonal bank of
 * Aargau, not to the one of Appenzell. Each entry is keyed by the IID of the
 * bank's head office in SIX BankMaster, confirmed by its BIC in the BIC
 * directory on 29.10.2026 (`bic8`, held by ch-state-guarantee.test.ts against
 * data/bic.sqlite at every refresh). A branch or a QR-IID takes the entry of
 * its `headquarters_iid`.
 *
 * Solothurn (1995) and Appenzell Ausserrhoden (1996) sold their cantonal banks:
 * neither canton has one today, so neither appears.
 *
 * ## Source and licence
 *
 * Laws and other official enactments are not protected by copyright (Federal
 * Act on Copyright, art. 5), so the table may live in this public repository.
 * Every article was read on 29.10.2026 in the canton's official collection,
 * except where `source` names the LexFind copy that was read (Vaud, Schwyz).
 * Re-read once a year; known reforms to watch: Basel-Landschaft (2026).
 */

import type { ChStateGuarantee } from '../types.js';

/** The day every article below was read at its source. */
export const STATE_GUARANTEE_AS_OF = '2026-10-29';

interface StateGuaranteeRow {
  /** Two-letter canton code. */
  canton: string;
  /** First eight characters of the head office's BIC, as confirmed on 29.10.2026. */
  bic8: string;
  guaranteed: boolean;
  /** The law, its number in the cantonal collection, and the article. */
  source: string;
  /** The text that was read. */
  url: string;
  note?: string;
}

/**
 * Keyed by the five-digit IID of the head office (SIX BankMaster, `iid_type`
 * 1). 21 guarantees written in the law, 3 without (BEKB, BCV, BCGE).
 */
export const CANTONAL_BANK_STATE_GUARANTEE: Readonly<Record<string, StateGuaranteeRow>> = {
  '00700': {
    canton: 'ZH',
    bic8: 'ZKBKCHZZ',
    guaranteed: true,
    source: 'Kantonalbankgesetz (ZKBG), LS 951.1, § 6',
    url: 'https://www.zh.ch/de/politik-staat/gesetze-beschluesse/gesetzessammlung/zhlex-ls/erlass-951_1-1997_09_28-1998_01_01-127.html',
  },
  '00761': {
    canton: 'AG',
    bic8: 'KBAGCH22',
    guaranteed: true,
    source: 'Gesetz über die Aargauische Kantonalbank (AKBG), SAR 681.100, § 5',
    url: 'https://gesetzessammlungen.ag.ch/app/de/texts_of_law/681.100',
  },
  '00763': {
    canton: 'AI',
    bic8: 'AIKACH22',
    guaranteed: true,
    source: 'Gesetz über die Appenzeller Kantonalbank (KBG), GS 951.000, Art. 7',
    url: 'https://ai.clex.ch/app/de/texts_of_law/951.000',
  },
  '00764': {
    canton: 'TI',
    bic8: 'BSCTCH22',
    guaranteed: true,
    source: 'Legge sulla Banca dello Stato del Cantone Ticino, RL 960.100, art. 4',
    url: 'https://m3.ti.ch/CAN/RLeggi/public/index.php/raccolta-leggi/pdfatto/atto/622',
  },
  '00765': {
    canton: 'VS',
    bic8: 'BCVSCH2L',
    guaranteed: true,
    source: 'Loi sur la Banque cantonale du Valais (LBCVs), 620.1, art. 5',
    url: 'https://lex.vs.ch/app/fr/texts_of_law/620.1',
  },
  '00766': {
    canton: 'NE',
    bic8: 'BCNNCH22',
    guaranteed: true,
    source: 'Loi sur la Banque cantonale neuchâteloise (LBCN), RSN 621, art. 4',
    url: 'https://rsn.ne.ch/DATA/program/books/rsne/htm/621.htm',
  },
  '00767': {
    canton: 'VD',
    bic8: 'BCVLCH2L',
    guaranteed: false,
    source:
      'Loi organisant la Banque Cantonale Vaudoise (LBCV), BLV 951.01, version in force since 1 May 2010 (LexFind copy)',
    url: 'https://www.lexfind.ch/tolv/183980/fr',
    note: 'The law has no article granting a state guarantee.',
  },
  '00768': {
    canton: 'FR',
    bic8: 'BEFRCH22',
    guaranteed: true,
    source: 'Loi sur la Banque cantonale de Fribourg (LBCF), RSF 961.1, art. 3',
    url: 'https://bdlf.fr.ch/app/fr/texts_of_law/961.1',
  },
  '00769': {
    canton: 'BL',
    bic8: 'BLKBCH22',
    guaranteed: true,
    source: 'Kantonalbankgesetz, SGS 371, § 4',
    url: 'https://bl.clex.ch/app/de/texts_of_law/371',
  },
  '00770': {
    canton: 'BS',
    bic8: 'BKBBCHBB',
    guaranteed: true,
    source: 'Gesetz über die Basler Kantonalbank, SG 915.200, § 9',
    url: 'https://bs.lexwork.naz.ch/de/dta/915.200.pdf',
  },
  '00773': {
    canton: 'GL',
    bic8: 'GLKBCH22',
    guaranteed: true,
    source: 'Gesetz über die Glarner Kantonalbank (Kantonalbankgesetz), GS IX B/31/1, Art. 5',
    url: 'https://gesetze.gl.ch/app/de/texts_of_law/IX%20B%2F31%2F1',
  },
  '00774': {
    canton: 'GR',
    bic8: 'GRKBCH22',
    guaranteed: true,
    source: 'Gesetz über die Graubündner Kantonalbank, BR 938.200, Art. 5',
    url: 'https://www.gr-lex.gr.ch/app/de/texts_of_law/938.200',
  },
  '00777': {
    canton: 'SZ',
    bic8: 'KBSZCH22',
    guaranteed: true,
    source:
      'Gesetz über die Schwyzer Kantonalbank, SRSZ 321.100, § 7, version of 1 January 2015 (LexFind copy)',
    url: 'https://www.lexfind.ch/tolv/83644/de',
  },
  '00778': {
    canton: 'LU',
    bic8: 'LUKBCH22',
    guaranteed: true,
    source:
      'Gesetz über die Umwandlung der Luzerner Kantonalbank in eine Aktiengesellschaft (Umwandlungsgesetz), SRL 690, § 5',
    url: 'https://lu.lexwork.naz.ch/de/dta/690.pdf',
  },
  '00779': {
    canton: 'NW',
    bic8: 'NIKACH22',
    guaranteed: true,
    source: 'Gesetz über die Nidwaldner Kantonalbank (Kantonalbankgesetz, NKBG), NG 866.1, Art. 6',
    url: 'https://gesetze.nw.ch/app/de/texts_of_law/866.1',
  },
  '00780': {
    canton: 'OW',
    bic8: 'OBWKCH22',
    guaranteed: true,
    source: 'Gesetz über die Obwaldner Kantonalbank (Kantonalbankgesetz), GDB 661.1, Art. 5',
    url: 'https://ow.lexwork.naz.ch/de/dta/661.1.pdf',
  },
  '00781': {
    canton: 'SG',
    bic8: 'KBSGCH22',
    guaranteed: true,
    source: 'Kantonalbankgesetz (KBG), sGS 861.2, Art. 6',
    url: 'https://www.gesetzessammlung.sg.ch/app/de/texts_of_law/861.2',
  },
  '00782': {
    canton: 'SH',
    bic8: 'SHKBCH2S',
    guaranteed: true,
    source: 'Gesetz über die Schaffhauser Kantonalbank, SHR 951.100, Art. 4',
    url: 'https://rechtsbuch.sh.ch/app/de/texts_of_law/951.100',
  },
  '00784': {
    canton: 'TG',
    bic8: 'KBTGCH22',
    guaranteed: true,
    source: 'Gesetz über die Thurgauer Kantonalbank (TKB-G), RB 951.1, § 5',
    url: 'https://www.rechtsbuch.tg.ch/app/de/texts_of_law/951.1',
  },
  '00785': {
    canton: 'UR',
    bic8: 'URKNCH22',
    guaranteed: true,
    source: 'Gesetz über die Urner Kantonalbank (UKBG), RB 70.1311, Art. 7',
    url: 'https://rechtsbuch.ur.ch/app/de/texts_of_law/70.1311',
  },
  '00787': {
    canton: 'ZG',
    bic8: 'KBZGCH22',
    guaranteed: true,
    source: 'Gesetz über die Zuger Kantonalbank (Kantonalbankgesetz; ZGKBG), BGS 651.1, § 3',
    url: 'https://zg.lexwork.naz.ch/de/dta/651.1.pdf',
  },
  '00788': {
    canton: 'GE',
    bic8: 'BCGECHGG',
    guaranteed: false,
    source:
      'Loi sur la Banque cantonale de Genève (LBCGe), rsGE D 2 05, art. 4 (repealed) and art. 25',
    url: 'https://silgeneve.ch/legis/data/rsg_d2_05.htm',
    note: 'Art. 4, the state guarantee, was repealed with effect from 1 January 2013; art. 25 kept a capped transitional guarantee from 1 January 2013 to 31 December 2016.',
  },
  '00789': {
    canton: 'JU',
    bic8: 'BCJUCH22',
    guaranteed: true,
    source: 'Loi sur la Banque cantonale du Jura, RSJU 951.11, art. 6',
    url: 'https://rsju.jura.ch/fr/viewdocument.html?idn=20217&id=28834&v=2&Download=1',
  },
  '00790': {
    canton: 'BE',
    bic8: 'KBBECH22',
    guaranteed: false,
    source:
      'Gesetz über die Aktiengesellschaft Berner Kantonalbank (AGBEKBG), BSG 951.10, Art. 4 (repealed) and Art. T1-1',
    url: 'https://www.belex.sites.be.ch/app/de/texts_of_law/951.10',
    note: 'Art. 4, the state guarantee, was repealed with effect from 1 January 2006. Under Art. T1-1, from 1 January 2013 the canton remains liable only for bonds (Anleihen) still outstanding on that date, until they mature, and, subsidiarily, for the other obligations that already existed on 1 January 2006, until they mature or their notice period ends.',
  },
};

/**
 * The state guarantee of the cantonal bank whose head office has this IID, or
 * null when the IID is not the head office of a cantonal bank. Callers pass
 * the entry's `headquarters_iid`, so that a branch and a QR-IID take their
 * head office's answer.
 */
export function stateGuaranteeForHeadOffice(
  headquartersIid: string | null | undefined,
): ChStateGuarantee | null {
  if (!headquartersIid) return null;
  const row = CANTONAL_BANK_STATE_GUARANTEE[headquartersIid.padStart(5, '0')];
  if (!row) return null;
  return {
    guaranteed: row.guaranteed,
    canton: row.canton,
    source: row.source,
    url: row.url,
    as_of: STATE_GUARANTEE_AS_OF,
    ...(row.note ? { note: row.note } : {}),
  };
}
