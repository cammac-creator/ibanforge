import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  RU_DIRECTORY_URL,
  buildRussiaRegister,
  parseEd807,
  readAttributes,
  readEd807Zip,
  readRussiaLive,
} from './seed-national-ru.js';

/**
 * 🔒 Répertoire INVENTÉ : le vrai passe par le fichier privé et n'entre pas dans ce
 * dépôt public. BIK 0499999xx et BIC en `ZZ`, absents du vrai répertoire le
 * 28/10/2026. La forme est celle de l'ED807 du jour (racine, espace de noms,
 * `ParticipantInfo`, `RstrList`, `SWBICS`, `Accounts`).
 */
const SOURCE =
  'Bank of Russia, BIC directory of the Bank of Russia payment system (ED807), https://www.cbr.ru';

function entry(bik: string, info: string, body = ''): string {
  return `<BICDirectoryEntry BIC="${bik}"><ParticipantInfo ${info}></ParticipantInfo>${body}</BICDirectoryEntry>`;
}

const DIRECTORY = [
  '<?xml version="1.0" encoding="WINDOWS-1251"?>',
  '<ED807 xmlns="urn:cbr-ru:ed:v2.0" EDNo="1" EDDate="2026-10-28" BusinessDay="2026-10-29">',
  // Un siège : deux BIC SWIFT, celui par défaut est servi.
  entry(
    '049999901',
    'NameP="АО &quot;Альфа-Тест&quot;" RegN="9001" PtType="20" ParticipantStatus="PSAC"',
    '<SWBICS SWBIC="ZZOTRUMMXXX" DefaultSWBIC="0"/><SWBICS SWBIC="ZZALRUMMXXX" DefaultSWBIC="1"/>' +
      '<Accounts Account="30101810000000000001" AccountStatus="ACAC"></Accounts>',
  ),
  // Une seconde ligne de siège de la même licence, sans BIC SWIFT.
  entry('049999904', 'NameP="АО «АЛЬФА-ТЕСТ»" RegN="9001" PtType="20" ParticipantStatus="PSAC"'),
  // Sa succursale, sans BIC SWIFT.
  entry(
    '049999902',
    'NameP="Филиал № 1 АО «Альфа-Тест»" RegN="9001/1" PrntBIC="049999901" PtType="30" ParticipantStatus="PSAC"',
  ),
  // Une banque au BIC par défaut étranger : nommée, sans BIC.
  entry(
    '049999911',
    'NameP="Банк развития Тест" PtType="20" ParticipantStatus="PSAC"',
    '<SWBICS SWBIC="ZZDVKZKAXXX" DefaultSWBIC="1"/>',
  ),
  // Une banque à la participation restreinte : écartée.
  `<BICDirectoryEntry BIC="049999921"><ParticipantInfo NameP="ООО НКО «Гамма-Тест»" PtType="20" ParticipantStatus="PSAC"><RstrList Rstr="URRS" RstrDate="2026-01-01"/></ParticipantInfo></BICDirectoryEntry>`,
  // La succursale d'une banque écartée : écartée aussi.
  entry(
    '049999922',
    'NameP="Филиал ООО НКО «Гамма-Тест»" PrntBIC="049999921" PtType="30" ParticipantStatus="PSAC"',
  ),
  // Une division de la Banque de Russie, un administrateur de liquidation : écartés.
  entry('049999931', 'NameP="ОКЦ № 99 Тест" PtType="12" ParticipantStatus="PSAC"'),
  entry(
    '049999941',
    'NameP="КУ ООО КБ «Дельта-Тест» - ГК «АСВ»" PtType="90" ParticipantStatus="PSAC"',
  ),
  '</ED807>',
].join('');

/** windows-1251 : l'ASCII, l'alphabet cyrillique, et les trois signes du répertoire. */
function cp1251(text: string): Buffer {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c >= 0x410 && c <= 0x44f) out.push(c - 0x410 + 0xc0);
    else if (ch === 'Ё') out.push(0xa8);
    else if (ch === 'ё') out.push(0xb8);
    else if (ch === '№') out.push(0xb9);
    else if (ch === '«') out.push(0xab);
    else if (ch === '»') out.push(0xbb);
    else throw new Error(`no windows-1251 byte for ${ch}`);
  }
  return Buffer.from(out);
}

/** Une archive ZIP (deflate), un membre par fichier, comme cbr.ru la sert. */
function zip(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const compressed = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, compressed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

describe('parseEd807', () => {
  it('reads the business day and every participant, entities decoded', () => {
    const d = parseEd807(DIRECTORY);
    expect(d.businessDay).toBe('2026-10-29');
    expect(d.participants.map((p) => p.bik)).toEqual([
      '049999901',
      '049999904',
      '049999902',
      '049999911',
      '049999921',
      '049999922',
      '049999931',
      '049999941',
    ]);
    const head = d.participants[0];
    expect(head.name).toBe('АО "Альфа-Тест"');
    expect(head.swift).toEqual([
      { bic: 'ZZOTRUMMXXX', isDefault: false },
      { bic: 'ZZALRUMMXXX', isDefault: true },
    ]);
    expect(d.participants[4].restrictions).toEqual(['URRS']);
    expect(d.participants[2].parent).toBe('049999901');
    // Le numéro de licence, sans le numéro de succursale.
    expect(d.participants.map((p) => p.licence).slice(0, 4)).toEqual([
      '9001',
      '9001',
      '9001',
      null,
    ]);
  });

  it('refuses rather than guesses', () => {
    expect(() => parseEd807('<ED806 BusinessDay="2026-10-29"></ED806>')).toThrow(/no ED807 root/);
    expect(() =>
      parseEd807('<ED807 xmlns="urn:example" BusinessDay="2026-10-29"></ED807>'),
    ).toThrow(/namespace/);
    expect(() => parseEd807('<ED807 xmlns="urn:cbr-ru:ed:v2.0"></ED807>')).toThrow(/business day/);
    const wrap = (body: string) =>
      `<ED807 xmlns="urn:cbr-ru:ed:v2.0" BusinessDay="2026-10-29">${body}</ED807>`;
    const ok = entry('049999901', 'NameP="Тест" PtType="20" ParticipantStatus="PSAC"');
    expect(() => parseEd807(wrap(ok.replace('049999901', '4999901')))).toThrow(/nine-digit BIK/);
    expect(() => parseEd807(wrap(ok + ok))).toThrow(/listed twice/);
    expect(() => parseEd807(wrap(`${ok}<BICDirectoryEntry BIC="049999902"/>`))).toThrow(
      /entries opened/,
    );
    expect(() => parseEd807(wrap(ok.replace('Тест', 'Тест &nbsp;')))).toThrow(/unknown XML entity/);
    expect(() => parseEd807(wrap(''))).toThrow(/no participant/);
  });

  it('refuses a tag that carries something other than attributes', () => {
    expect(readAttributes(' a="1" b="&amp;2"/')).toEqual({ a: '1', b: '&2' });
    expect(() => readAttributes(' a="1" b=2')).toThrow(/not an attribute/);
    expect(() => readAttributes(' a="1" a="2"')).toThrow(/twice/);
  });
});

describe('buildRussiaRegister', () => {
  const register = buildRussiaRegister(parseEd807(DIRECTORY));

  it('serves active, unrestricted credit institutions and branches, by name and default SWIFT BIC', () => {
    expect(register.entries).toEqual([
      {
        code: '049999901',
        name: 'АО "Альфа-Тест"',
        bic: 'ZZALRUMMXXX',
        street: null,
        post_code: null,
        town: null,
        lei: null,
        source: SOURCE,
        as_of: '2026-10-29',
      },
      expect.objectContaining({ code: '049999904', bic: null }),
      expect.objectContaining({ code: '049999902', bic: null }),
      expect.objectContaining({ code: '049999911', name: 'Банк развития Тест', bic: null }),
    ]);
  });

  it('gives every served BIK its licence, head offices and branches alike', () => {
    expect(register.licences).toEqual(
      ['049999901', '049999904', '049999902'].map((code) => ({
        code,
        licence: '9001',
        source: SOURCE,
        as_of: '2026-10-29',
      })),
    );
  });

  it('says what it left out', () => {
    expect(register.notes).toEqual([
      '049999921: participation restricted (URRS), left out',
      '2 participants that are neither credit institutions nor branches, left out',
      '049999922: branch whose head office 049999921 is not served, left out',
      '049999911: default SWIFT BIC ZZDVKZKAXXX is not a Russian BIC, not served',
    ]);
  });

  it('refuses two licences serving the same six-character BIC prefix', () => {
    const shared = DIRECTORY.replace('ZZDVKZKAXXX', 'ZZALRUM5XXX');
    expect(() => buildRussiaRegister(parseEd807(shared))).toThrow(
      /prefix ZZALRU is served by several institutions/,
    );
  });

  it('refuses a participant marking two default SWIFT BICs', () => {
    const twice = DIRECTORY.replace('DefaultSWBIC="0"', 'DefaultSWBIC="1"');
    expect(() => buildRussiaRegister(parseEd807(twice))).toThrow(/several default/);
  });
});

describe('readEd807Zip and readRussiaLive', () => {
  const archive = zip({ '20261029_ED807_full.xml': cp1251(DIRECTORY) });

  it('decodes the windows-1251 file of the archive', () => {
    expect(readEd807Zip(archive)).toBe(DIRECTORY);
  });

  it('refuses a page, or an archive that is not the directory', () => {
    expect(() => readEd807Zip(Buffer.from('<html>DDoS-Guard</html>'))).toThrow(/not serve a ZIP/);
    expect(() => readEd807Zip(zip({ 'other.xml': cp1251(DIRECTORY) }))).toThrow(
      /expected one ED807 file/,
    );
    expect(() =>
      readEd807Zip(
        zip({
          '20261029_ED807_full.xml': cp1251(DIRECTORY),
          '20261030_ED807_full.xml': cp1251(DIRECTORY),
        }),
      ),
    ).toThrow(/expected one ED807 file/);
  });

  it('reads the stable address and returns the served lines', async () => {
    const asked: string[] = [];
    const r = await readRussiaLive(async (url) => {
      asked.push(url);
      return archive;
    }, 0);
    expect(asked).toEqual([RU_DIRECTORY_URL]);
    expect(r.entries.map((e) => e.code)).toEqual([
      '049999901',
      '049999904',
      '049999902',
      '049999911',
    ]);
    expect(r.licences).toHaveLength(3);
  });

  it('refuses the whole directory under the licence floor, before any name is written', async () => {
    await expect(readRussiaLive(async () => archive)).rejects.toThrow(
      /only 3 licences, expected at least \d+/,
    );
  });
});
