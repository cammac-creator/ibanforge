import { describe, expect, it } from 'vitest';
import {
  MAX_LINE_LENGTH,
  MAX_PAGE_BYTES,
  MAX_PDF_BYTES,
  TR_PAGE,
  TR_SOURCE,
  buildTurkeyRegister,
  parseTurkeyText,
  readTurkeyLive,
  turkeyPdfUrl,
} from './seed-national-tr.js';

/**
 * Le chargeur de la liste des participants des systèmes de paiement de la TCMB
 * (scripts/seed-national-tr.ts, membre `register_tr` de la surcouche privée).
 *
 * 🔒 Tout est INVENTÉ : participants, noms, identifiants de document. La liste est de la
 * case 2 de la règle du 28/10/2026 (usage commercial soumis à l'accord écrit de la TCMB)
 * et n'entre pas dans ce dépôt public. Les codes 0291 à 0293 et 0881 ne sont choisis
 * d'après aucune vraie ligne.
 */

/** Le texte que `pdftotext -layout` rend d'une page de la liste, avec les marques de note. */
const TEXT = [
  '                         TCMB ÖDEME SİSTEMLERİ KATILIMCILARI (2026)',
  '         Kod       Banka Adı',
  '  1      0291      ÖRNEK KATILIM BANKASI A.Ş. (*)',
  '  2      0292      DENEME   YATIRIM BANKASI A.Ş.',
  '  3      0881      ÖRNEK KAYIT KURULUŞU A.Ş.',
  '  4      0293      SINAMA BANK A.Ş. (****)',
  '(*) 01.01.2026 tarihinde 0291 kodlu Örnek Katılım Bankası A.Ş. TCMB Ödeme Sistemlerine katılmıştır.',
  '(****) 02.02.2026 tarihinde 0293 kodlu Eski Unvan A.Ş.’nin ünvanı Sınama Bank A.Ş. olarak güncellenmiştir.',
  '03.03.2026 tarihinde 0299 kodlu Ayrılan Bankası A.Ş. Sistem dışına çıkarılmıştır.',
  '',
].join('\n');

/** Une page EFT inventée : le lien des participants, celui de la liste FAST, et un autre PDF. */
function page(links: string[]): string {
  return `<html><body>${links.map((l) => `<a href="${l}">buradan</a>`).join(' ')}</body></html>`;
}
const PARTICIPANTS =
  '/wps/wcm/connect/00000000-0000-0000-0000-000000000001/TCMB+%C3%96deme+Sistemleri+Kat%C4%B1l%C4%B1mc%C4%B1lar%C4%B1+%282099%29.pdf?MOD=AJPERES';
const FAST =
  '/wps/wcm/connect/00000000-0000-0000-0000-000000000002/FAST+S%C4%B0STEM%C4%B0+KATILIMCILARI+2099.pdf?MOD=AJPERES';
const OTHER = '/wps/wcm/connect/00000000-0000-0000-0000-000000000003/Rapor.pdf?MOD=AJPERES';

describe('la liste des participants de la TCMB (scripts/seed-national-tr.ts)', () => {
  it('lit les lignes, ôte les marques de note et resserre les espaces du nom', () => {
    expect(parseTurkeyText(TEXT)).toEqual([
      { n: 1, participant: '0291', name: 'ÖRNEK KATILIM BANKASI A.Ş.' },
      { n: 2, participant: '0292', name: 'DENEME YATIRIM BANKASI A.Ş.' },
      { n: 3, participant: '0881', name: 'ÖRNEK KAYIT KURULUŞU A.Ş.' },
      { n: 4, participant: '0293', name: 'SINAMA BANK A.Ş.' },
    ]);
  });

  it('sert le code de l’IBAN (un zéro devant), sans BIC, et écarte les participants numérotés dès 0800', () => {
    const { entries, notes } = buildTurkeyRegister(parseTurkeyText(TEXT), '2099-01-15');
    expect(entries.map((e) => e.code)).toEqual(['00291', '00292', '00293']);
    for (const e of entries) {
      expect(e.code).toMatch(/^\d{5}$/);
      expect(e.bic).toBeNull();
      expect(e.source).toBe(TR_SOURCE);
      expect(e.as_of).toBe('2099-01-15');
      expect([e.street, e.post_code, e.town, e.lei]).toEqual([null, null, null, null]);
    }
    expect(notes).toEqual(['0881: numbered 0800 or above, not a bank, left out']);
  });

  it('ne lit pas les remarques du pied de page comme des participants', () => {
    // 0299 n'est cité que dans une remarque : il n'est pas servi.
    const codes = parseTurkeyText(TEXT).map((r) => r.participant);
    expect(codes).not.toContain('0299');
  });

  it('suit l’en-tête répété d’une page suivante, et refuse plutôt que deviner', () => {
    const twoPages = TEXT.replace(
      '  3      0881',
      '\f                         TCMB ÖDEME SİSTEMLERİ KATILIMCILARI (2026)\n         Kod       Banka Adı\n  3      0881',
    );
    expect(parseTurkeyText(twoPages)).toHaveLength(4);
    expect(() => parseTurkeyText(TEXT.replace('Kod       Banka Adı', 'Code   Name'))).toThrow(
      /header not found/,
    );
    expect(() => parseTurkeyText(TEXT.replace('  2      0292', '  5      0292'))).toThrow(
      /row 2 expected/,
    );
    expect(() => parseTurkeyText(TEXT.replace('0292', '0291'))).toThrow(/listed twice/);
    expect(() =>
      parseTurkeyText(
        TEXT.replace('  4      0293', 'une ligne inconnue entre deux participants\n  4      0293'),
      ),
    ).toThrow(/after the end of the table/);
    expect(() => parseTurkeyText(TEXT.replace(/^ {2}1 .*$/m, '  1      0291      (*)'))).toThrow(
      /has no name/,
    );
  });

  it('refuse une ligne démesurée avant de lui appliquer la moindre expression', () => {
    // Une ligne pleine d'espaces : ROW et NOTE_MARK y reviendraient en arrière à chaque
    // position. Refusée d'emblée, sans attendre ; une ligne à la limite passe.
    const piege = `  1      0291      A${' '.repeat(200_000)}B (*)`;
    expect(() => parseTurkeyText(TEXT.replace(/^ {2}1 .*$/m, piege))).toThrow(
      `TR: a line is longer than ${MAX_LINE_LENGTH} characters; layout changed`,
    );
    const limite = `  1      0291      ${'A'.repeat(MAX_LINE_LENGTH - 19)}`;
    expect(limite).toHaveLength(MAX_LINE_LENGTH);
    expect(parseTurkeyText(TEXT.replace(/^ {2}1 .*$/m, limite))[0]?.participant).toBe('0291');
  });

  it('trouve le seul lien des participants sur la page, jamais celui de la liste FAST', () => {
    expect(turkeyPdfUrl(page([OTHER, PARTICIPANTS, FAST, PARTICIPANTS]))).toBe(
      `https://www.tcmb.gov.tr${PARTICIPANTS}`,
    );
    expect(() => turkeyPdfUrl(page([OTHER, FAST]))).toThrow(/found 0/);
    expect(() => turkeyPdfUrl(page([PARTICIPANTS, PARTICIPANTS.replace('2099', '2098')]))).toThrow(
      /found 2/,
    );
    // Un lien hors du gestionnaire de contenu de la TCMB n'est pas suivi.
    expect(() => turkeyPdfUrl(page([`https://example.net${PARTICIPANTS}`]))).toThrow(/found 0/);
  });

  it('lit en ligne la page, puis le PDF, sous leurs plafonds', async () => {
    const asked: Array<[string, number]> = [];
    const get = async (url: string, maxBytes: number): Promise<Buffer> => {
      asked.push([url, maxBytes]);
      if (url === TR_PAGE) return Buffer.from(page([PARTICIPANTS, FAST]));
      return Buffer.from('%PDF-1.7 inventé');
    };
    const read = await readTurkeyLive(get, '2099-01-15', () => TEXT);
    expect(asked).toEqual([
      [TR_PAGE, MAX_PAGE_BYTES],
      [`https://www.tcmb.gov.tr${PARTICIPANTS}`, MAX_PDF_BYTES],
    ]);
    expect(read.entries.map((e) => e.code)).toEqual(['00291', '00292', '00293']);
    expect(read.url).toBe(`https://www.tcmb.gov.tr${PARTICIPANTS}`);
  });

  it('refuse un lien qui ne sert pas un PDF', async () => {
    const get = async (url: string): Promise<Buffer> =>
      url === TR_PAGE ? Buffer.from(page([PARTICIPANTS])) : Buffer.from('<html>refus</html>');
    await expect(readTurkeyLive(get, '2099-01-15', () => TEXT)).rejects.toThrow(
      /did not serve a PDF/,
    );
  });

  it('remonte un refus HTTP de la page tel quel, pour le rapport de la chaîne privée', async () => {
    const get = async (url: string): Promise<Buffer> => {
      throw new Error(`TR: ${url} -> HTTP 503`);
    };
    await expect(readTurkeyLive(get)).rejects.toThrow(/HTTP 503/);
  });
});
