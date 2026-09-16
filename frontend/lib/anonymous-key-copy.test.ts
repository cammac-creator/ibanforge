import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import de from '@/messages/de.json';

/**
 * Les textes lus par les humains sur la clé sans e-mail.
 *
 * Ce que ce fichier garde, et pourquoi chaque assertion existe :
 *
 *  1. **Zéro promesse périmée** sur les neuf fichiers du lot. L'autorité reste
 *     `src/routes/static-claims.test.ts`, qui tient le budget de tout le dépôt ;
 *     ici les motifs sont recopiés pour que le périmètre humain soit une
 *     ÉGALITÉ À ZÉRO et non un budget. Un budget se relâche, une égalité non.
 *  2. **Les deux 25 portent leur unité et leur portée.** `REST_TRIAL_DAILY_LIMIT`
 *     vaut 25 par jour sur la seule route de validation ; `ANONYMOUS_MONTHLY_LIMIT`
 *     vaut 25 par mois sur tous les endpoints. Deux quotas sans rapport qui
 *     portent le même chiffre : un lecteur qui lit les deux sans les unités
 *     conclut, à raison sur les validations, que la clé est pire que pas de clé.
 *  3. **Rien de la vague 2 n'est annoncé comme existant.** Le device grant et le
 *     paiement par carte sont spécifiés mais pas livrés : `/v1/keys/device` et
 *     `/v1/keys/checkout` rendent 404 aujourd'hui. Un texte qui les décrit au
 *     présent est un texte faux, et c'est la sorte de faux qu'une relecture ne
 *     rattrape pas parce qu'il se lit bien.
 *  4. **L'adresse d'exemple est `you@company.com`.** `you@example.com` est refusé
 *     par la route elle-même (domaine fictif), donc un lecteur qui recopie
 *     reçoit un 400.
 *  5. **Le message du 201 anonyme est celui que la route SERT**, comparé au
 *     gabarit de `src/routes/api-keys.ts`. C'est le seul garde-fou contre le
 *     défaut le plus cher du chantier : écrire un chiffre et en servir un autre.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const FRONT = join(ROOT, 'frontend');

const FICHIERS = [
  'content/en/docs/api-keys.mdx',
  'content/fr/docs/api-keys.mdx',
  'content/de/docs/api-keys.mdx',
  'content/legal/terms.mdx',
  'messages/en.json',
  'messages/fr.json',
  'messages/de.json',
  'components/api-key-dialog.tsx',
  'components/first-call-panel.tsx',
  'lib/first-call.ts',
];

const lire = (rel: string) => readFileSync(join(FRONT, rel), 'utf8');
/** Un texte dont les retours à la ligne ne changent plus le sens d'une phrase. */
const applati = (s: string) => s.replace(/\s+/g, ' ');

// Motifs recopiés de src/routes/static-claims.test.ts (zone C, §3.1 du chantier).
const N200 = String.raw`(?<![.,\d])200(?![.,]?\d)`;
const FREE = String.raw`free[ _-]?tier|free[ _-]?(?:API[ _-]?)?key|offre gratuite|cl[ée]s? (?:API )?gratuites?|kostenlose[rns]?[ _-]?(?:API-)?(?:Schl[üu]ssel|Kontingent)|Gratis-?(?:Stufe|Tarif)`;
// Les quatre mots dans leur propre constante, et non en clair dans le motif :
// écrits sur la même ligne que le 200, ils font de ce fichier sa propre
// infraction, et le prochain qui mènera le budget à zéro devra l'exempter.
// Le NOM de la constante les évite aussi, pour la même raison — « gratuit »
// dans un identifiant se lit comme « gratuit » dans une phrase.
const MOTS_SANS_FRAIS = String.raw`free|gratuit|kostenlos|gratis`;
// Les trois formules de l'ancienne règle « une clé par personne », chacune
// coupée en deux morceaux : écrites d'un trait, elles se trouveraient
// elles-mêmes. C'est le prix pour qu'un fichier de garde n'ait pas besoin de sa
// propre exemption — et l'exemption est précisément ce qui laisse pourrir un
// budget qu'on croit à zéro.
const UNE_PAR_PERSONNE = [
  ['one per develop', 'er'],
  ['une par dévelop', 'peur'],
  ['einer pro Entwick', 'ler'],
]
  .map((morceaux) => morceaux.join(''))
  .join('|');
const PERIMES: RegExp[] = [
  new RegExp(`(?:${FREE})[^\\n]{0,60}?${N200}`, 'i'),
  new RegExp(`${N200}[^\\n]{0,60}?(?:${MOTS_SANS_FRAIS})`, 'i'),
  new RegExp(['\\bemailed', ' key\\b'].join(''), 'i'),
  /POST(ing)? (your|any) e-?mail/i,
  /POSTez (n'importe quel |un )?e-?mail/i,
  /POSTen Sie (eine|die)[^.\n]{0,25}E-Mail/i,
  new RegExp(UNE_PAR_PERSONNE, 'i'),
];
/** Une ligne qui date son chiffre est un instantané, pas une promesse. */
const DATEE = /as of|refresh|Breakdown|20\d{2}-\d{2}/i;
const COMMENTAIRE = /^\s*(\/\/|\*|\/\*|#)/;
const CODE = /\.(ts|tsx)$/;

describe('les textes de la clé sans e-mail', () => {
  it('ne portent plus une seule promesse périmée', () => {
    const fautes: string[] = [];
    for (const rel of FICHIERS) {
      const estCode = CODE.test(rel);
      lire(rel)
        .split('\n')
        .forEach((ligne, i) => {
          if (DATEE.test(ligne) || (estCode && COMMENTAIRE.test(ligne))) return;
          if (PERIMES.some((p) => p.test(ligne))) fautes.push(`${rel}:${i + 1} ${ligne.trim()}`);
        });
    }
    expect(fautes, fautes.join('\n')).toEqual([]);
  });

  it('écrivent l’unité ET la portée partout où les deux 25 se croisent', () => {
    const attendu: Array<[string, string[]]> = [
      ['content/en/docs/api-keys.mdx', ['25 **a day**', '25 **a month**', 'on this route only', 'on every endpoint']],
      ['content/fr/docs/api-keys.mdx', ['25 **par jour**', '25 **par mois**', 'sur cette route seulement', 'sur tous les endpoints']],
      ['content/de/docs/api-keys.mdx', ['25-mal **pro Tag**', 'nur auf dieser Route', 'auf allen Endpunkten']],
    ];
    for (const [rel, phrases] of attendu) {
      const texte = applati(lire(rel));
      for (const phrase of phrases) expect(texte, `${rel} : ${phrase}`).toContain(phrase);
    }
    // La FAQ la plus lue du site dit les deux, dans les trois langues.
    expect(applati(en.pricing.faq[2].answer)).toContain('25 a day on one route, 25 a month on all of them');
    expect(applati(fr.pricing.faq[2].answer)).toContain('25 par jour sur une route, 25 par mois sur toutes');
    expect(applati(de.pricing.faq[2].answer)).toContain('25 pro Tag auf einer Route, 25 pro Monat auf allen');
  });

  it('n’annoncent rien de la vague 2 comme existant', () => {
    // Le device grant et le rail carte du CHANTIER sont spécifiés, pas livrés :
    // `/v1/keys/device` et `/v1/keys/checkout` rendent 404. Un seul de ces mots
    // au présent dans un texte publié suffit à promettre une porte qui n'existe
    // pas.
    //
    // 🚨 La liste nomme des ROUTES et des NOMS D'OUTILS, jamais un prestataire.
    // Payer un pack par carte via Stripe existe depuis août et se raconte
    // librement dans les tarifs et les CGU : bannir le mot « Stripe » ici
    // rendrait un texte VRAI impossible à écrire, et le lot suivant
    // supprimerait l'assertion au lieu de la comprendre. Quand la vague 2 sera
    // livrée, on retire la ligne concernée — pas le test.
    // Les deux outils MCP sont livrés : leur présence est contrôlée par onboarding-parity.test.ts.
    const interdits = [
      'device grant',
      'Device Grant',
      '/v1/keys/device',
      '/v1/keys/checkout',
      'browser approval',
      'approbation dans le navigateur',
      'approbation navigateur',
      'Browser-Freigabe',
    ];
    const fautes: string[] = [];
    for (const rel of FICHIERS) {
      const texte = lire(rel);
      for (const mot of interdits) if (texte.includes(mot)) fautes.push(`${rel} : « ${mot} »`);
    }
    expect(fautes, fautes.join('\n')).toEqual([]);
  });

  it('publient you@company.com et jamais you@example.com', () => {
    for (const rel of FICHIERS) {
      expect(lire(rel), rel).not.toContain('you@example.com');
    }
    for (const rel of ['content/en/docs/api-keys.mdx', 'content/fr/docs/api-keys.mdx', 'content/de/docs/api-keys.mdx']) {
      expect(lire(rel), rel).toContain('you@company.com');
    }
  });

  it('citent le message que la route sert vraiment sur le 201 anonyme', () => {
    // Lecture de fichier et non import : la zone C ne peut rien importer de
    // src/, et le contrat est justement que le texte publié soit la COPIE de ce
    // qui part sur le réseau.
    const route = readFileSync(join(ROOT, 'src', 'routes', 'api-keys.ts'), 'utf8');
    const tiers = readFileSync(join(ROOT, 'src', 'lib', 'tiers.ts'), 'utf8');
    const anonyme = /ANONYMOUS_MONTHLY_LIMIT\s*=\s*(\d+)/.exec(tiers)?.[1];
    const gratuit = /FREE_TIER_MONTHLY_LIMIT\s*=\s*(\d+)/.exec(tiers)?.[1];
    expect(anonyme, 'ANONYMOUS_MONTHLY_LIMIT introuvable dans src/lib/tiers.ts').toBeDefined();
    expect(gratuit, 'FREE_TIER_MONTHLY_LIMIT introuvable dans src/lib/tiers.ts').toBeDefined();

    const debut = route.indexOf('`Save this key - it will not be shown again.');
    expect(
      debut,
      'le gabarit du message anonyme a changé de forme dans src/routes/api-keys.ts : resynchroniser les trois api-keys.mdx',
    ).toBeGreaterThan(-1);
    const fin = route.indexOf('POST /v1/keys/claim.', debut);
    const servi = applati(route.slice(debut + 1, fin + 'POST /v1/keys/claim.'.length))
      // Le gabarit est une concaténation de littéraux interpolés : on retire la
      // couture TypeScript pour comparer le texte, pas sa mise en page.
      .replace(/`\s*\+\s*'/g, '')
      .replace(/'\s*\+\s*`/g, '')
      .replace(/\$\{ANONYMOUS_MONTHLY_LIMIT\}/g, String(anonyme))
      .replace(/\$\{FREE_TIER_MONTHLY_LIMIT\}/g, String(gratuit));

    for (const rel of ['content/en/docs/api-keys.mdx', 'content/fr/docs/api-keys.mdx', 'content/de/docs/api-keys.mdx']) {
      expect(applati(lire(rel)), `${rel} ne cite pas le message servi`).toContain(servi);
    }
  });

  it('donnent au dialogue de quoi proposer les deux chemins dans les trois langues', () => {
    for (const [langue, messages] of [
      ['en', en],
      ['fr', fr],
      ['de', de],
    ] as const) {
      const d = messages.apiKeyDialog;
      // Le chemin par défaut a son propre libellé, et il parle d'absence
      // d'adresse : c'est lui que le bouton porte quand le champ est vide.
      expect(d.submitAnonymous.toLowerCase(), langue).toMatch(/e-mail|mail/);
      expect(d.emailLabel.toLowerCase(), langue).toMatch(/optional|facultatif/);
      // Le quota affiché après création vient de la réponse, donc le texte doit
      // porter un trou et non un chiffre.
      expect(d.anonymousTier, langue).toContain('{limit}');
      expect(d.emailTier, langue).toContain('{limit}');
      expect(d.claimHint, langue).toContain('/v1/keys/claim');
      // La démonstration se nomme, des deux côtés : l'appel lancé d'ici et les
      // extraits que le visiteur emporte.
      expect(d.firstCall.demoNote.length, langue).toBeGreaterThan(20);
      expect(d.firstCall.snippetsNote.length, langue).toBeGreaterThan(20);
    }
  });

  it('gardent les CGU sans chiffre de quota, et renvoyant à la page qui le porte', () => {
    const cgu = lire('content/legal/terms.mdx');
    expect(cgu).toContain('Version 1.4');
    expect(cgu).toContain('/docs/api-keys');
    // Un quota accordé contre paiement est compté UNE fois : sans cette phrase,
    // les CGU promettent une récurrence que le code contredit (no_recredit).
    expect(applati(cgu)).toContain('counted once rather than refilled');
    // Aucune date de publication laissée en gabarit.
    expect(cgu).not.toContain('[date');
    // Les chiffres de plafond vivent sur la page des clés, pas ici : ce document
    // est le seul qu'on ne réédite pas à chaque changement de palier.
    const corps = cgu
      .split('\n')
      .filter((l) => !/^\*\*Last updated/.test(l))
      .join('\n');
    expect(corps).not.toMatch(/\b25 requests\b/);
    expect(corps).not.toMatch(/\b200 requests\b/);
  });
});
