/**
 * Les trois registres privés (Estonie, Monténégro, Serbie) réduits à quelques lignes,
 * pour les essais qui passent par la vraie validation.
 *
 * Les tables entières ne sont pas dans ce dépôt public : les permissions de la
 * Finantsinspektsioon, de la Banque centrale du Monténégro et de la Banque nationale
 * de Serbie portent sur les réponses de l'API, une entrée par requête
 * (src/lib/ee-register.ts, me-register.ts, rs-register.ts). Un essai écrit donc un
 * fichier privé de quelques lignes dans un dossier temporaire et pointe
 * `EE_REGISTER_PATH` / `ME_REGISTER_PATH` / `RS_REGISTER_PATH` dessus. Les lignes sont des citations de test (les mêmes que les fragments de
 * scripts/fixtures/registers/) ; les DATES, elles, sont inventées et lointaines
 * (2098, 2099) : ce qu'un essai lit dans la réponse vient du fichier, jamais d'une
 * horloge ni de la vraie lecture.
 *
 * Volontairement sans aucun import de vitest (scripts/check-runtime-deps.ts lit
 * tout fichier non-test de src/ comme du code d'exécution) : l'essai pose lui-même
 * la variable avec `vi.stubEnv`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const EE_FIXTURE = {
  schema: 1,
  source: 'Source: Finantsinspektsioon',
  pages: {
    credit_institutions: {
      url: 'https://www.fi.ee/en/banking-and-credit/applying-activity-licences/identity-codes-international-account-numbers-credit-institutions',
      edited: '2098-12-31',
    },
    payment_institutions: {
      url: 'https://www.fi.ee/en/payment-and-e-money-services/applying-operating-licence-payment-services/identity-codes-international-account-numbers-payment-institutions-and-e-money-institutions',
      edited: '2099-01-02',
    },
  },
  bic_source: {
    name: 'Eesti Pangaliit (Estonian Banking Association), list of bank codes',
    url: 'https://pangaliit.ee/settlements-and-standards/bank-codes',
  },
  read_on: '2099-03-04',
  entries: [
    { code: '22', name: 'Swedbank AS', kind: 'credit_institution', bic: 'HABAEE2X' },
    { code: '10', name: 'AS SEB Pank', kind: 'credit_institution', bic: 'EEUHEE2X' },
    { code: '96', name: 'Luminor Bank AS', kind: 'credit_institution', bic: 'RIKOEE22' },
    { code: '17', name: 'Luminor Bank AS', kind: 'credit_institution', bic: 'RIKOEE22' },
    {
      code: '12',
      name: 'AS Citadele banka Eesti filiaal',
      kind: 'foreign_credit_institution_branch',
      bic: null,
    },
    { code: '88', name: 'Wallester AS', kind: 'payment_or_e_money_institution', bic: 'WALLEE22' },
    { code: '15', name: 'inHouse Pay AS', kind: 'payment_or_e_money_institution', bic: null },
  ],
} as const;

export const ME_FIXTURE = {
  schema: 1,
  source: 'Source: Central Bank of Montenegro',
  publication:
    'https://www.cbcg.me/en/core-functions/payment-system/cbcg-payment-system/rtgs-system',
  read_on: '2099-03-04',
  entries: [
    { code: '907', name: 'Centralna banka Crne Gore', bic: 'CBCGMEPG' },
    { code: '510', name: 'Crnogorska komercijalna banka AD', bic: 'CKBCMEPG' },
    { code: '530', name: 'NLB Banka AD', bic: 'MNBAMEPG' },
    { code: '535', name: 'Prva banka Crne Gore AD - Osnovana 1901. godine', bic: 'PRVAMEPG' },
  ],
} as const;

export const RS_FIXTURE = {
  schema: 1,
  source: 'Source: National Bank of Serbia',
  publication:
    'https://www.nbs.rs/export/sites/NBS_site/documents-eng/platni-sistem/banks_account_numbers.pdf',
  published: '2099-01-02',
  read_on: '2099-03-04',
  entries: [
    {
      code: '105',
      name: 'AIKBANK AKCIONARSKO DRUŠTVO, BEOGRAD',
      bic: 'AIKBRS22XXX',
      registration_number: '06876366',
    },
    {
      code: '160',
      name: 'BANCA INTESA AKCIONARSKO DRUŠTVO BEOGRAD',
      bic: 'DBDBRSBGXXX',
      registration_number: '07759231',
    },
    {
      code: '200',
      name: 'BANKA POŠTANSKA ŠTEDIONICA AKCIONARSKO DRUŠTVO, BEOGRAD',
      bic: 'SBPORSBGXXX',
      registration_number: '07004893',
    },
    {
      code: '265',
      name: 'RAIFFEISEN BANKA A.D. BEOGRAD',
      bic: 'RZBSRSBGXXX',
      registration_number: '17335600',
    },
  ],
} as const;

/** Un dossier temporaire et le fichier privé qu'il porte ; `remove()` efface le dossier. */
export function writePrivateFixture(
  fileName: string,
  content: unknown,
): { path: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ibf-ee-me-'));
  const path = join(dir, fileName);
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content), {
    mode: 0o600,
  });
  return { path, remove: () => rmSync(dir, { recursive: true, force: true }) };
}
