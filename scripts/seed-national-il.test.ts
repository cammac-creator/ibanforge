import { describe, expect, it } from 'vitest';
import {
  IL_DATASETS,
  IL_PUBLISHER,
  buildIsraelRegister,
  israelSource,
  israeliBic,
  parseIsraelPackage,
  readIsraelLive,
} from './seed-national-il.js';

/**
 * 🔒 Des banques INVENTÉES (Société Alpha, Bank Beta…), jamais une ligne des jeux de
 * la Banque d'Israël : la source est de la case 2 (règle du 28/10/2026), elle
 * n'entre pas dans ce dépôt public. Seules les formes sont reproduites : un code de
 * banque en nombre, un BIC en minuscules, le BIC étranger d'une succursale, un
 * nom à deux espaces, les agences ouvertes et fermées.
 */
const BANKS = [
  { Bank_Code: 901, Name: 'Alpha Bank  Ltd', Swift_Code: 'ZZALILITXXX' },
  { Bank_Code: 92, Name: 'Bank Beta Ltd', Swift_Code: 'zzbeilit' },
  { Bank_Code: 93, Name: 'Gamma Bank PLC', Swift_Code: 'ZZGAGB22' },
  { Bank_Code: 9, Name: 'Delta Clearing Ltd', Swift_Code: '' },
];

const BRANCHES = [
  // Un code que la liste des banques porte déjà : elle gagne, l'agence est ignorée.
  { Bank_Code: '901', Bank_Name: 'Alpha Group', Close_Date: '' },
  // Une banque d'un groupe, qui garde son code : nommée, sans BIC.
  { Bank_Code: '94', Bank_Name: 'Epsilon Bank Ltd', Close_Date: '' },
  { Bank_Code: '94', Bank_Name: 'Epsilon Bank Ltd', Close_Date: '01/01/2020' },
  // Un code dont toutes les agences sont fermées : rien.
  { Bank_Code: '95', Bank_Name: 'Zeta Bank Ltd', Close_Date: '31/12/2019' },
];

const SNAPSHOT = {
  banks: BANKS,
  banksUpdated: '2026-10-28',
  branches: BRANCHES,
  branchesUpdated: '2026-10-27',
};

describe('israeliBic', () => {
  it('upper-cases, keeps an Israeli BIC, drops a foreign one and names why', () => {
    expect(israeliBic('zzbeilit')).toEqual({ bic: 'ZZBEILIT', dropped: null });
    expect(israeliBic(' ZZALILITXXX ')).toEqual({ bic: 'ZZALILITXXX', dropped: null });
    expect(israeliBic('ZZGAGB22')).toEqual({ bic: null, dropped: 'foreign_bic' });
    expect(israeliBic('n/a')).toEqual({ bic: null, dropped: 'not_a_bic' });
    expect(israeliBic('')).toEqual({ bic: null, dropped: null });
  });
});

describe('buildIsraelRegister', () => {
  it('pads the codes, lets the bank list win, names the codes only the branch list knows', () => {
    const { entries, notes } = buildIsraelRegister(SNAPSHOT);
    expect(entries.map((e) => [e.code, e.name, e.bic, e.as_of])).toEqual([
      ['901', 'Alpha Bank Ltd', 'ZZALILITXXX', '2026-10-28'],
      ['092', 'Bank Beta Ltd', 'ZZBEILIT', '2026-10-28'],
      ['093', 'Gamma Bank PLC', null, '2026-10-28'],
      ['009', 'Delta Clearing Ltd', null, '2026-10-28'],
      ['094', 'Epsilon Bank Ltd', null, '2026-10-27'],
    ]);
    expect(entries[0].source).toBe(israelSource('banks'));
    expect(entries[4].source).toBe(israelSource('branches'));
    expect(notes).toEqual([
      '093: published BIC dropped (foreign_bic)',
      '094: named from the branch list, no BIC',
    ]);
  });

  it('refuses a bank code listed twice, or open branches that disagree on the name', () => {
    expect(() => buildIsraelRegister({ ...SNAPSHOT, banks: [...BANKS, BANKS[0]] })).toThrow(
      /listed twice/,
    );
    expect(() =>
      buildIsraelRegister({
        ...SNAPSHOT,
        branches: [...BRANCHES, { Bank_Code: '94', Bank_Name: 'Eta Bank Ltd', Close_Date: '' }],
      }),
    ).toThrow(/disagree on the bank name/);
    expect(() =>
      buildIsraelRegister({
        ...SNAPSHOT,
        banks: [{ Bank_Code: 'x', Name: 'Theta', Swift_Code: '' }],
      }),
    ).toThrow(/no readable Bank_Code/);
  });
});

function packageBody(dataset: keyof typeof IL_DATASETS, publisher = IL_PUBLISHER) {
  return {
    success: true,
    result: {
      organization: { title: publisher },
      resources: [
        { id: IL_DATASETS[dataset].resource, last_modified: '2026-10-28T10:00:33.881496' },
      ],
    },
  };
}

describe('parseIsraelPackage', () => {
  it('reads the update day of the resource and checks the publisher', () => {
    expect(parseIsraelPackage(packageBody('banks'), 'banks')).toEqual({ updated: '2026-10-28' });
    expect(() => parseIsraelPackage(packageBody('banks', 'Société Alpha'), 'banks')).toThrow(
      /no longer published by the Bank of Israel/,
    );
    expect(() => parseIsraelPackage(packageBody('banks'), 'branches')).toThrow(/left its dataset/);
  });
});

describe('readIsraelLive', () => {
  /** Un portail de doublure : les deux fiches, puis les ressources page par page. */
  function portal(branchTotal = BRANCHES.length) {
    return async (url: string): Promise<unknown> => {
      const u = new URL(url);
      if (u.pathname.endsWith('/package_show'))
        return packageBody(u.searchParams.get('id') === '375' ? 'banks' : 'branches');
      const resource = u.searchParams.get('resource_id');
      const offset = Number(u.searchParams.get('offset'));
      const limit = Number(u.searchParams.get('limit'));
      const rows = resource === IL_DATASETS.banks.resource ? BANKS : BRANCHES;
      const total = resource === IL_DATASETS.banks.resource ? BANKS.length : branchTotal;
      return { success: true, result: { records: rows.slice(offset, offset + limit), total } };
    };
  }

  it('reads both datasets through the API', async () => {
    const { entries } = await readIsraelLive(portal());
    expect(entries.map((e) => e.code)).toEqual(['901', '092', '093', '009', '094']);
  });

  it('reads a portal that caps its pages under the requested limit', async () => {
    const capped = portal();
    const get = async (url: string): Promise<unknown> => {
      const body = (await capped(url)) as { result?: { records?: unknown[] } };
      if (body.result?.records) body.result.records = body.result.records.slice(0, 2);
      return body;
    };
    const { entries } = await readIsraelLive(get);
    expect(entries.map((e) => e.code)).toEqual(['901', '092', '093', '009', '094']);
  });

  it('refuses a branch list that lost its Close_Date field', () => {
    const branches = [{ Bank_Code: '94', Bank_Name: 'Epsilon Bank Ltd' }];
    expect(() => buildIsraelRegister({ ...SNAPSHOT, branches })).toThrow(/no Close_Date field/);
  });

  it('refuses a resource that served fewer rows than it announced', async () => {
    await expect(readIsraelLive(portal(BRANCHES.length + 3))).rejects.toThrow(
      /announced 7 rows, 4/,
    );
  });
});
