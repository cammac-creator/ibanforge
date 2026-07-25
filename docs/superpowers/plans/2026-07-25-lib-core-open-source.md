# t23 — Bibliothèque IBAN open source : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraire la couche de calcul IBAN d'IBANforge dans une bibliothèque open source publiée sur npm sous le nom `ibanforge`, dont la sortie indique elle-même où obtenir l'enrichissement payant.

**Architecture:** Nouveau dépôt public `cammac-creator/iban-core`, source unique (code déplacé, jamais copié). IBANforge consomme ensuite le paquet npm. Les modules extraits n'ont aucune dépendance à la base de données ni au réseau.

**Tech Stack:** TypeScript 5 (ES2022, ESM), vitest, tsup pour le double build ESM+CJS, GitHub Actions, npm.

## Global Constraints

- **Zéro dépendance de production.** `dependencies` doit rester un objet vide dans le `package.json` de la bibliothèque. Un test le vérifie (Tâche 4).
- **Zéro appel réseau.** La bibliothèque ne fait jamais de requête HTTP. Le champ `enrich` est purement déclaratif.
- **Aucune donnée propriétaire.** Ne jamais extraire : la base BIC, le clearing suisse SIX, les listes de sanctions, le score de risque.
- **Licence MIT**, identique au dépôt principal.
- **Node >= 20**, `"type": "module"`.
- **Langue du code et des commits : anglais.** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
- **Critère de migration non négociable (Tâche 6) :** les 607 tests d'IBANforge passent **sans qu'aucun ne soit modifié**. Seuls les chemins d'import changent.
- Chemin du nouveau dépôt en local : `~/iban-core`.

---

### Task 1: Échafaudage du dépôt et module `countries`

`countries.ts` n'importe rien : c'est le socle sur lequel tout le reste s'appuie. On le déplace en premier pour que le dépôt soit testable dès le premier commit.

**Files:**
- Create: `~/iban-core/package.json`, `tsconfig.json`, `vitest.config.ts`, `LICENSE`, `.gitignore`, `.github/workflows/ci.yml`
- Create: `~/iban-core/src/countries.ts` (copié depuis `~/ibanforge/src/lib/countries.ts`, inchangé)
- Test: `~/iban-core/src/countries.test.ts` (copié depuis `~/ibanforge/src/lib/countries.test.ts`)

**Interfaces:**
- Consumes: rien.
- Produces: `IBAN_LENGTHS`, `BBAN_STRUCTURE`, `BBAN_SPECS`, `EXAMPLE_IBANS`, `COUNTRY_NAMES`, `checkBBANStructure(countryCode: string, bban: string): BbanCheckResult`, `getBBANFieldSpec(countryCode: string, start: number, length: number): string | null`, `getSepaInfo`, `getCountryRisk`, types `BBANStructure`, `BbanCheckResult`, `SepaScheme`.

- [ ] **Step 1: Créer le dépôt local et le `package.json`**

```bash
mkdir -p ~/iban-core/src && cd ~/iban-core && git init
```

`~/iban-core/package.json` :

```json
{
  "name": "ibanforge",
  "version": "2.0.0",
  "description": "IBAN validation with EMI/virtual-IBAN detection. Zero dependencies, offline, 89 countries: mod-97 (ISO 13616), BBAN parsing, SEPA + VoP reachability, and issuer classification (Wise, Revolut, N26, Mercury...).",
  "keywords": ["iban", "iban-validation", "bic", "swift", "sepa", "vop", "emi", "virtual-iban", "fintech", "mod-97", "iso-13616", "zero-dependencies"],
  "license": "MIT",
  "author": "cammac-creator",
  "repository": { "type": "git", "url": "git+https://github.com/cammac-creator/iban-core.git" },
  "homepage": "https://github.com/cammac-creator/iban-core",
  "bugs": { "url": "https://github.com/cammac-creator/iban-core/issues" },
  "type": "module",
  "engines": { "node": ">=20" },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "sideEffects": false,
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^22.10.2",
    "tsup": "^8.3.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --clean",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm run test && npm run build",
    "prepublishOnly": "npm run check"
  }
}
```

- [ ] **Step 2: Créer `tsconfig.json`, `vitest.config.ts` et `.gitignore`**

`~/iban-core/tsconfig.json` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`~/iban-core/vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
```

`~/iban-core/.gitignore` :

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 3: Copier la licence MIT**

```bash
cp ~/ibanforge/LICENSE ~/iban-core/LICENSE
```

- [ ] **Step 4: Déplacer `countries.ts` et son test**

```bash
cp ~/ibanforge/src/lib/countries.ts ~/iban-core/src/countries.ts
cp ~/ibanforge/src/lib/countries.test.ts ~/iban-core/src/countries.test.ts
```

`countries.ts` n'a aucun import, il part tel quel. Dans `countries.test.ts`, corriger le seul chemin d'import :

```ts
// avant : import { ... } from './countries.js';
// après : identique — le fichier est au même niveau. Aucun changement requis.
```

Vérifier qu'aucun import ne pointe vers `../types.js` :

```bash
grep -n "types.js" ~/iban-core/src/countries.ts ~/iban-core/src/countries.test.ts || echo "OK : aucune dependance aux types du produit"
```

- [ ] **Step 5: Installer et lancer les tests**

```bash
cd ~/iban-core && npm install && npm run test
```

Attendu : les 16 tests de `countries.test.ts` passent.

- [ ] **Step 6: Ajouter la CI GitHub Actions**

`~/iban-core/.github/workflows/ci.yml` :

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm install
      - run: npm run check
```

- [ ] **Step 7: Premier commit**

```bash
cd ~/iban-core && git add -A && git commit -m "chore: scaffold the library and move the country tables in

countries.ts carries the IBAN length table, BBAN structures, SEPA membership
and VoP obligation for 89 countries. It imports nothing, so it is the natural
first move: the repo is testable from its first commit."
```

---

### Task 2: Module `iban` et champ `enrich`

Le cœur. Deux changements par rapport au fichier d'origine : le type de retour devient `IbanResult` (défini dans la bibliothèque, sans les champs résolus par la base), et `cost_usdc` disparaît au profit de `enrich`.

**Files:**
- Create: `~/iban-core/src/types.ts`
- Create: `~/iban-core/src/iban.ts` (depuis `~/ibanforge/src/lib/iban.ts`)
- Test: `~/iban-core/src/iban.test.ts` (depuis `~/ibanforge/src/lib/iban.test.ts`), `~/iban-core/src/enrich-hint.test.ts`

**Interfaces:**
- Consumes: de `./countries.js` — `IBAN_LENGTHS`, `BBAN_STRUCTURE`, `COUNTRY_NAMES`, `getSepaInfo`, `checkBBANStructure`.
- Produces: `validate(input: string): IbanResult`, type `IbanResult`, type `EnrichHint`.

- [ ] **Step 1: Créer `src/types.ts`**

```ts
/** What the library can compute offline. Everything the paid API resolves
 *  (bank name, BIC, Swiss clearing, sanctions) is deliberately absent. */
export interface IbanResult {
  iban: string;
  valid: boolean;
  country?: { code: string; name: string };
  check_digits?: string;
  bban?: { bank_code: string; branch_code?: string; account_number: string };
  sepa?: { member: boolean; schemes: Array<'SCT' | 'SDD' | 'SCT_INST'>; vop_required: boolean };
  formatted?: string;
  error?:
    | 'invalid_format'
    | 'unsupported_country'
    | 'wrong_length'
    | 'checksum_failed'
    | 'invalid_check_digits'
    | 'invalid_bban_structure';
  error_detail?: string;
  enrich?: EnrichHint;
}

/** Machine-readable pointer to what this library cannot know. An assistant
 *  reading a result finds the next step here, without reading the README. */
export interface EnrichHint {
  hint: string;
  free_tier: string;
  docs: string;
}
```

- [ ] **Step 2: Écrire le test du champ `enrich` (il doit échouer)**

`~/iban-core/src/enrich-hint.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { validate } from './iban.js';

describe('the enrich hint', () => {
  it('is present on a valid IBAN and names what the library cannot know', () => {
    const r = validate('CH10 0023 0000 0000 1234 5');
    expect(r.valid).toBe(true);
    expect(r.enrich).toBeDefined();
    expect(r.enrich?.hint).toMatch(/bank name/i);
    expect(r.enrich?.hint).toMatch(/api\.ibanforge\.com/);
    expect(r.enrich?.free_tier).toMatch(/200/);
  });

  it('is absent on an invalid IBAN — there is nothing to enrich', () => {
    expect(validate('XX00BAD').enrich).toBeUndefined();
  });

  it('never carries a price: this library is free', () => {
    expect(JSON.stringify(validate('CH1000230000000012345'))).not.toMatch(/cost_usdc/);
  });
});
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

```bash
cd ~/iban-core && npx vitest run src/enrich-hint.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./iban.js"`.

- [ ] **Step 4: Déplacer `iban.ts` et l'adapter**

```bash
cp ~/ibanforge/src/lib/iban.ts ~/iban-core/src/iban.ts
```

Trois modifications dans `~/iban-core/src/iban.ts` :

1. Remplacer l'import de type :

```ts
// avant : import type { IBANValidationResult } from '../types.js';
import type { IbanResult } from './types.js';
```

2. Renommer la fonction exportée et son type de retour. `validateIBAN` devient `validate` (nom naturel pour une bibliothèque autonome) :

```ts
export function validate(input: string): IbanResult {
```

3. Supprimer **toutes** les occurrences de `cost_usdc: 0.005,` (il y en a une par branche de retour), et ajouter le champ `enrich` sur le seul chemin de succès, juste avant le `return result;` final :

```ts
const ENRICH: EnrichHint = {
  hint:
    'Bank name, BIC/SWIFT, Swiss SIX clearing rails and sanctions screening ' +
    'cannot be computed offline — resolve them at https://api.ibanforge.com',
  free_tier: '200 requests/month, no card',
  docs: 'https://ibanforge.com/docs',
};

// … dans validate(), sur le chemin de succès uniquement :
result.enrich = ENRICH;
return result;
```

Importer le type : `import type { IbanResult, EnrichHint } from './types.js';`

- [ ] **Step 5: Déplacer et adapter le test d'origine**

```bash
cp ~/ibanforge/src/lib/iban.test.ts ~/iban-core/src/iban.test.ts
```

Dans `~/iban-core/src/iban.test.ts`, deux remplacements mécaniques :
- `from '../lib/iban.js'` ou `from './iban.js'` → `from './iban.js'`
- toutes les occurrences de `validateIBAN(` → `validate(`

Puis supprimer les assertions portant sur `cost_usdc`, qui n'a plus de sens ici :

```bash
grep -n "cost_usdc" ~/iban-core/src/iban.test.ts
```

Chaque ligne trouvée est une assertion à retirer. C'est la **seule** modification de test autorisée dans tout ce plan, et elle est justifiée : le prix est une notion du produit, pas de la bibliothèque.

- [ ] **Step 6: Lancer les tests**

```bash
cd ~/iban-core && npm run test
```

Attendu : `countries.test.ts`, `iban.test.ts` et `enrich-hint.test.ts` passent tous.

- [ ] **Step 7: Commit**

```bash
cd ~/iban-core && git add -A && git commit -m "feat: mod-97 validation with a machine-readable enrichment hint

validateIBAN becomes validate, and the commercial cost_usdc field is gone —
the library is free, so a price in its output would be nonsense.

In its place, a valid result carries an enrich block naming exactly what
cannot be computed offline (bank name, BIC, Swiss clearing, sanctions) and
where to get it. An assistant hitting the limit of this library finds the
next step in the answer itself, without reading the README."
```

---

### Task 3: Modules `bic-validator`, `issuers` et `compliance-static`

Trois modules feuilles. `issuers-generated.ts` est un fichier **généré** : son générateur reste dans IBANforge car il croise les registres publics EBA/FCA avec la base BIC privée. On déplace la sortie, pas le générateur.

**Files:**
- Create: `~/iban-core/src/bic-validator.ts`, `src/issuers.ts`, `src/issuers-generated.ts`, `src/compliance-static.ts`
- Test: `~/iban-core/src/bic-validator.test.ts`, `src/issuers.test.ts`, `src/compliance-static.test.ts`
- Modify: `~/ibanforge/scripts/build-issuer-index.mjs:23` (chemin de sortie)

**Interfaces:**
- Consumes: rien hors de la bibliothèque.
- Produces: `isValidBIC(code: string): BicResult`, `classifyIssuer(bic8: string, institutionName?: string): IssuerInfo | null`, `normalizeIssuerName(name: string): string`, types `IssuerType`, `IssuerInfo`, `BicResult`.

- [ ] **Step 1: Déplacer les quatre modules et leurs tests**

```bash
cd ~/ibanforge/src/lib
cp bic-validator.ts issuers.ts issuers-generated.ts compliance-static.ts ~/iban-core/src/
cp bic-validator.test.ts issuers.test.ts compliance-static.test.ts ~/iban-core/src/
```

- [ ] **Step 2: Couper la dernière dépendance aux types du produit**

`bic-validator.ts` importe `BICValidationResult` depuis `../types.js`. Ajouter le type dans `~/iban-core/src/types.ts` :

```ts
export interface BicResult {
  bic: string;
  valid_format: boolean;
  bic8?: string;
  bic11?: string;
  branch_code?: string;
  country?: string;
  error?: string;
}
```

Puis dans `~/iban-core/src/bic-validator.ts` :

```ts
// avant : import type { BICValidationResult } from '../types.js';
import type { BicResult } from './types.js';
```

et remplacer toutes les occurrences de `BICValidationResult` par `BicResult`.

- [ ] **Step 3: Vérifier qu'aucun module ne référence plus le produit**

```bash
cd ~/iban-core && grep -rn "\.\./types\|lib/db\|better-sqlite3\|sqlite" src/ && echo "ECHEC : dependance residuelle" || echo "OK : la bibliotheque est autonome"
```

Attendu : `OK : la bibliotheque est autonome`.

- [ ] **Step 4: Lancer les tests**

```bash
cd ~/iban-core && npm run test
```

Attendu : les tests des quatre modules passent (49 pour `issuers`, 16 pour `bic-validator`, 10 pour `compliance-static`).

- [ ] **Step 5: Rediriger le générateur d'issuers vers la bibliothèque**

Dans `~/ibanforge/scripts/build-issuer-index.mjs`, ligne 23 :

```js
// avant : const OUT = 'src/lib/issuers-generated.ts';
// Le fichier généré vit désormais dans la bibliothèque open source. Le
// générateur reste ici : il croise les registres publics EBA/FCA avec la base
// BIC, qui est privée et ne quitte pas ce dépôt.
const OUT = process.env.ISSUERS_OUT ?? '../iban-core/src/issuers-generated.ts';
```

- [ ] **Step 6: Commit**

```bash
cd ~/iban-core && git add -A && git commit -m "feat: BIC format validation, EMI/vIBAN classification, FATF status

The issuer classification is what sets this library apart: no competing IBAN
library tells you the account belongs to Wise, Revolut or N26 rather than a
bank. It rests on public bank codes and the public EBA/FCA registers.

issuers-generated.ts is a build artefact. Its generator stays in the ibanforge
repo because it cross-matches those public registers against the BIC database,
which is private and does not travel."

cd ~/ibanforge && git add scripts/build-issuer-index.mjs && git commit -m "chore(issuers): emit the generated index into the open-source library"
```

---

### Task 4: Surface publique, garde zéro-dépendance et README

**Files:**
- Create: `~/iban-core/src/index.ts`, `~/iban-core/src/package-contract.test.ts`, `~/iban-core/README.md`

**Interfaces:**
- Consumes: tous les modules des tâches 1 à 3.
- Produces: l'API publique du paquet.

- [ ] **Step 1: Écrire la garde du contrat de paquet (elle doit échouer)**

`~/iban-core/src/package-contract.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from './index.js';

const pkg = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
);

describe('the package keeps its promises', () => {
  it('has zero production dependencies — the headline claim', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  it('exports exactly the documented surface', () => {
    expect(Object.keys(lib).sort()).toEqual(
      [
        'validate',
        'isValidBIC',
        'classifyIssuer',
        'normalizeIssuerName',
        'getCountryRisk',
        'getSepaInfo',
        'checkBBANStructure',
        'getBBANFieldSpec',
        'IBAN_LENGTHS',
        'BBAN_STRUCTURE',
        'BBAN_SPECS',
        'COUNTRY_NAMES',
        'EXAMPLE_IBANS',
      ].sort(),
    );
  });

  it('validates the canonical example of every supported country', () => {
    const failures = Object.entries(lib.EXAMPLE_IBANS)
      .filter(([, iban]) => !lib.validate(iban).valid)
      .map(([code]) => code);
    expect(failures).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd ~/iban-core && npx vitest run src/package-contract.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./index.js"`.

- [ ] **Step 3: Écrire `src/index.ts`**

La surface exporte aussi les tables de structure par pays. Ce n'est pas de la fuite de périmètre : ce sont des données publiques (registre IBAN), elles sont utiles en soi (« quel est le format d'un IBAN portugais ? »), et c'est exactement ce que consomment `src/routes/iban-structure.ts` et `src/routes/openapi.ts` dans IBANforge, qui devront s'approvisionner ici après la tâche 6.

```ts
// Calculation
export { validate } from './iban.js';
export { isValidBIC } from './bic-validator.js';
export { classifyIssuer, normalizeIssuerName } from './issuers.js';

// Country reference data (public IBAN registry)
export {
  getCountryRisk,
  getSepaInfo,
  checkBBANStructure,
  getBBANFieldSpec,
  IBAN_LENGTHS,
  BBAN_STRUCTURE,
  BBAN_SPECS,
  COUNTRY_NAMES,
  EXAMPLE_IBANS,
} from './countries.js';

export type { IbanResult, EnrichHint, BicResult } from './types.js';
export type { IssuerType, IssuerInfo } from './issuers.js';
export type { BBANStructure, BbanCheckResult, SepaScheme } from './countries.js';
```

- [ ] **Step 4: Lancer les tests**

```bash
cd ~/iban-core && npm run check
```

Attendu : typecheck, tous les tests, et le build tsup passent.

- [ ] **Step 5: Écrire le README**

`~/iban-core/README.md` :

````markdown
# ibanforge

IBAN validation with **EMI / virtual-IBAN detection**. Zero dependencies, fully offline.

```bash
npm install ibanforge
```

```js
import { validate, classifyIssuer } from 'ibanforge';

validate('CH10 0023 0000 0000 1234 5');
// { valid: true, country: { code: 'CH', name: 'Switzerland' },
//   bban: { bank_code: '00230', account_number: '000000012345' },
//   sepa: { member: true, schemes: ['SCT','SDD'], vop_required: false },
//   enrich: { hint: 'Bank name, BIC/SWIFT, Swiss SIX clearing rails …' } }

classifyIssuer('REVOGB21');   // { type: 'emi', name: 'Revolut' }
```

## What it does

- **mod-97 validation** (ISO 13616) and BBAN parsing for **89 countries**
- **SEPA membership** and **VoP obligation** (EU 2024/886) per country
- **EMI / virtual-IBAN detection** — tells a real bank apart from Wise, Revolut, N26, Mercury or Modulr
- **BIC format validation** (ISO 9362)
- FATF status and country risk, from public lists

## What it does not do

The checksum proves an IBAN is *well-formed*. It cannot tell you **who** the bank
is. That needs a database, and this library ships none:

| Question | Here | Needs data |
|---|---|---|
| Is this IBAN well-formed? | yes | |
| Is it a virtual IBAN from an EMI? | yes | |
| Which bank is behind it? | | [api.ibanforge.com](https://api.ibanforge.com) |
| Swiss SIX clearing rails, QR-IID? | | [api.ibanforge.com](https://api.ibanforge.com) |
| Is the bank sanctioned (OFAC/EU/UN)? | | [api.ibanforge.com](https://api.ibanforge.com) |

Every valid result carries an `enrich` field pointing there. The free tier is
200 requests/month, no card.

## Licence

MIT
````

- [ ] **Step 6: Commit**

```bash
cd ~/iban-core && git add -A && git commit -m "feat: public surface, package contract guard and README

The contract test pins the three promises the README makes: zero production
dependencies, a stable export surface, and a valid canonical example for all
89 supported countries. Break any of them and CI fails.

The README states plainly what the library cannot do. A checksum proves an
IBAN is well-formed; it cannot say who the bank is. Being honest about that
line is what makes the enrich hint credible rather than an advert."
```

---

### Task 5: Publier le dépôt et le paquet

**Files:** aucun changement de code.

**Interfaces:**
- Consumes: le dépôt complet des tâches 1 à 4.
- Produces: `github.com/cammac-creator/iban-core` et `ibanforge@2.0.0` sur npm.

- [ ] **Step 1: Créer le dépôt GitHub public et pousser**

```bash
cd ~/iban-core
gh repo create cammac-creator/iban-core --public \
  --description "IBAN validation with EMI/virtual-IBAN detection. Zero dependencies, offline, 89 countries." \
  --source=. --remote=origin --push
```

- [ ] **Step 2: Ajouter les sujets GitHub (découvrabilité)**

```bash
gh repo edit cammac-creator/iban-core --add-topic iban,iban-validation,sepa,bic,swift,fintech,typescript,zero-dependency,vop,emi
```

- [ ] **Step 3: Vérifier que la CI est verte**

```bash
cd ~/iban-core && gh run list --limit 1
```

Attendu : `completed  success`. Ne pas publier tant que ce n'est pas le cas.

- [ ] **Step 4: Vérifier le contenu réel du paquet avant publication**

```bash
cd ~/iban-core && npm pack --dry-run
```

Attendu : `dist/`, `README.md`, `LICENSE` et `package.json` uniquement. Aucun fichier `.test.ts`, aucune source `.ts`.

- [ ] **Step 5: Publier**

```bash
cd ~/iban-core && npm publish
```

**Note pour l'exécutant :** la publication npm de ce compte a déjà été bloquée par un jeton expiré et par la double authentification interactive. Si `npm publish` demande un code OTP, s'arrêter et le signaler à Claude-Alain : c'est une action qu'il doit faire lui-même, elle ne peut pas être automatisée.

- [ ] **Step 6: Vérifier la publication en direct**

```bash
npm view ibanforge version dist-tags
node -e "import('ibanforge').then(m => console.log(m.validate('CH1000230000000012345')))"
```

Attendu : version `2.0.0`, et un résultat valide portant le champ `enrich`.

---

### Task 6: Migrer IBANforge vers la bibliothèque

La tâche la plus délicate. Le garde-fou : **aucun des 607 tests d'IBANforge ne doit être modifié.**

`src/lib/iban.ts` n'est pas supprimé mais réduit à un adaptateur mince : il rétablit `cost_usdc` (que le produit facture) et retire `enrich` (proposer un complément à un client qui l'a déjà payé n'aurait aucun sens). C'est ce qui permet aux tests existants de passer sans retouche.

**Files:**
- Modify: `~/ibanforge/package.json` (ajouter la dépendance)
- Modify: `~/ibanforge/src/lib/iban.ts` (devient un adaptateur)
- Delete: `~/ibanforge/src/lib/countries.ts`, `bic-validator.ts`, `issuers.ts`, `issuers-generated.ts`, `compliance-static.ts` et leurs tests (déplacés en tâches 1 à 3)
- Create: `~/ibanforge/src/lib/countries.ts` → réexport de façade (voir étape 3)

**Interfaces:**
- Consumes: `validate`, `classifyIssuer`, `isValidBIC`, `getCountryRisk`, `EXAMPLE_IBANS` depuis `ibanforge@^2.0.0`.
- Produces: `validateIBAN(input: string): IBANValidationResult` — signature **inchangée** pour les 9 fichiers qui la consomment.

- [ ] **Step 1: Installer la bibliothèque**

```bash
cd ~/ibanforge && npm install ibanforge@^2.0.0
```

- [ ] **Step 2: Réduire `src/lib/iban.ts` à un adaptateur**

Remplacer **tout** le contenu de `~/ibanforge/src/lib/iban.ts` par :

```ts
import { validate } from 'ibanforge';
import type { IBANValidationResult } from '../types.js';

/**
 * Adapter over the open-source library (t23).
 *
 * The library is free, so it prices nothing and appends an `enrich` hint
 * telling the caller where to buy what it cannot compute. Inside the paid API
 * both are wrong: the call has a price, and the caller is already here — so we
 * restore cost_usdc and drop the hint.
 *
 * Keeping this thin adapter, rather than calling validate() everywhere, is
 * what lets the 607 existing tests pass untouched.
 */
export function validateIBAN(input: string): IBANValidationResult {
  const { enrich: _unused, ...base } = validate(input);
  return { ...base, cost_usdc: 0.005 };
}
```

- [ ] **Step 3: Remplacer les modules déplacés par des façades de réexport**

Neuf fichiers importent depuis `./countries.js`, cinq depuis `./bic-validator.js`, trois depuis `./issuers.js`. Plutôt que de réécrire vingt fichiers d'imports, on garde les chemins et on réexporte. Une seule source vivante, zéro import à toucher.

Remplacer **tout** le contenu de `~/ibanforge/src/lib/countries.ts` par :

```ts
// Moved to the open-source library (t23). Re-exported here so the twenty
// existing import sites keep working. Do not add logic in this file.
export {
  getCountryRisk,
  getSepaInfo,
  checkBBANStructure,
  getBBANFieldSpec,
  IBAN_LENGTHS,
  BBAN_STRUCTURE,
  BBAN_SPECS,
  COUNTRY_NAMES,
  EXAMPLE_IBANS,
} from 'ibanforge';
export type { BBANStructure, BbanCheckResult, SepaScheme } from 'ibanforge';
```

Cette liste est exactement la surface publiée en tâche 4, étape 3 : `src/routes/iban-structure.ts` et `src/routes/openapi.ts` consomment les tables de structure, et rien ne doit leur manquer.

Faire de même pour `bic-validator.ts` :

```ts
// Moved to the open-source library (t23).
export { isValidBIC } from 'ibanforge';
```

et `issuers.ts` :

```ts
// Moved to the open-source library (t23).
export { classifyIssuer, normalizeIssuerName } from 'ibanforge';
export type { IssuerType, IssuerInfo } from 'ibanforge';
```

- [ ] **Step 4: Supprimer les fichiers déplacés et leurs tests**

```bash
cd ~/ibanforge && git rm src/lib/issuers-generated.ts src/lib/compliance-static.ts \
  src/lib/countries.test.ts src/lib/iban.test.ts src/lib/bic-validator.test.ts \
  src/lib/issuers.test.ts src/lib/compliance-static.test.ts
```

Les tests supprimés vivent désormais dans le dépôt de la bibliothèque, où ils testent le code là où il est. Ce sont les **seuls** tests retirés, et ils ne sont pas perdus.

`compliance-static.ts` est consommé par `src/lib/compliance.ts` : y remplacer l'import par `from 'ibanforge'`.

- [ ] **Step 5: Lancer la vérification complète**

```bash
cd ~/ibanforge && npm run check
```

Attendu : typecheck, lint et **tous les tests restants passent, aucun modifié**. Si un test échoue, la cause est dans l'adaptateur ou une façade, jamais dans le test : le corriger là.

- [ ] **Step 6: Vérifier que le produit répond toujours pareil en local**

```bash
cd ~/ibanforge && NODE_ENV=development PORT=3111 CORS_ORIGIN='*' npm run dev &
sleep 8
curl -s 'http://localhost:3111/v1/iban/format?iban=CH1000230000000012345'
curl -s 'http://localhost:3111/v1/iban/structure/CH'
curl -s 'http://localhost:3111/v1/demo'
```

Attendu : les trois répondent 200 avec la même forme qu'avant. Vérifier en particulier qu'aucune réponse ne contient `enrich` (l'adaptateur doit l'avoir retiré) et que `/v1/iban/structure/CH` renvoie toujours `iban_length: 21`.

- [ ] **Step 7: Commit et déploiement**

```bash
cd ~/ibanforge && git add -A && git commit -m "refactor: consume the IBAN calculation from the open-source library

The mod-97 layer, the country tables, BIC format validation and the EMI
classification now live in cammac-creator/iban-core and ship as ibanforge on
npm. They exist in exactly one place: this repo installs them.

src/lib/iban.ts survives as a thin adapter — it restores cost_usdc, which the
product charges, and drops the enrich hint, which would be absurd to show a
caller who already paid. The moved modules keep their old paths as re-export
facades, so none of the twenty import sites had to change.

All remaining tests pass unmodified. The tests for the moved code moved with
it, and now run in the repo that owns the code."

git push origin main
```

---

## Notes d'exécution

**Ordre.** Les tâches 1 à 4 se font dans `~/iban-core` sans jamais toucher IBANforge. La tâche 6 dépend de la publication npm de la tâche 5.

**Sessions parallèles.** D'autres sessions travaillent régulièrement sur `~/ibanforge`. Avant chaque commit dans ce dépôt : `git fetch origin && git status`, et n'ajouter que ses propres fichiers, jamais `git add -A` sans avoir vérifié.

**Point de blocage connu.** La publication npm (tâche 5, étape 5) peut exiger un code de double authentification. Ce n'est pas automatisable : s'arrêter et le signaler.

**Si la tâche 6 dérape.** Le signal d'alarme est « il faut modifier un test ». Cela veut dire que l'adaptateur ou une façade ne restitue pas exactement l'ancien comportement. Corriger là, jamais dans le test.
