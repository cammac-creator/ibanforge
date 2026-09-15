import { describe, expect, it } from 'vitest';
import {
  DEVICE_USER_CODE_CHARSET,
  DEVICE_USER_CODE_LENGTH,
  countdownParts,
  formatUserCode,
  isCompleteUserCode,
  normalizeUserCode,
  routeDeviceFailure,
} from './device-code';
import en from '../messages/en.json';
import fr from '../messages/fr.json';
import de from '../messages/de.json';

/**
 * Le code d'appairage tel qu'un humain le tape : il vient d'un terminal, il
 * traverse un copier-coller ou une lecture à voix haute, et il arrive ici
 * accompagné de tout ce qu'un presse-papier ramasse.
 */
describe('normalizeUserCode', () => {
  it('laisse passer un code déjà propre', () => {
    expect(normalizeUserCode('WDJBMJHT')).toBe('WDJBMJHT');
  });

  it('retire le tiret d’affichage et met en majuscules', () => {
    expect(normalizeUserCode('wdjb-mjht')).toBe('WDJBMJHT');
  });

  it('survit à un copier-coller avec espaces et retours à la ligne', () => {
    expect(normalizeUserCode('  WDJB MJHT \n')).toBe('WDJBMJHT');
  });

  it('retire les caractères hors alphabet SANS les traduire', () => {
    // 🚨 La tentation est de lire `0` comme `O` et `1` comme `I` « pour
    // aider ». Ces lettres n'existent pas dans la base RFC 8628 retenue, donc
    // la correspondance serait inventée : un code juste pourrait devenir un
    // autre code juste, appartenant à quelqu'un d'autre. On jette.
    expect(normalizeUserCode('W0DJ1BMJHT')).toBe('WDJBMJHT');
    expect(normalizeUserCode('AEIOU')).toBe('');
  });

  it('ne garde jamais plus de huit caractères', () => {
    expect(normalizeUserCode('WDJBMJHTWDJBMJHT')).toBe('WDJBMJHT');
    expect(normalizeUserCode('WDJBMJHTWDJBMJHT')).toHaveLength(DEVICE_USER_CODE_LENGTH);
  });

  it('accepte chaque lettre de l’alphabet publié, et elles seules', () => {
    for (const ch of DEVICE_USER_CODE_CHARSET) {
      expect(normalizeUserCode(ch)).toBe(ch);
    }
    expect(DEVICE_USER_CODE_CHARSET).toHaveLength(20);
    // Aucune voyelle : c'est ce qui garantit qu'aucun mot involontaire ne sort
    // du tirage, et aucun chiffre, donc aucune confusion 0/O ni 1/I/L.
    expect(/[AEIOU0-9]/.test(DEVICE_USER_CODE_CHARSET)).toBe(false);
  });
});

describe('formatUserCode', () => {
  it('rend la forme publiée XXXX-XXXX', () => {
    expect(formatUserCode('WDJBMJHT')).toBe('WDJB-MJHT');
  });

  it('est idempotent sur ce que l’API renvoie déjà formaté', () => {
    expect(formatUserCode('WDJB-MJHT')).toBe('WDJB-MJHT');
  });

  it('n’affiche pas de tiret avant que le premier groupe soit plein', () => {
    // Sinon le champ montre `WDJB-` alors que l'humain n'a rien tapé du second
    // groupe, et le tiret se lit comme un caractère qu'il aurait produit.
    expect(formatUserCode('W')).toBe('W');
    expect(formatUserCode('WDJB')).toBe('WDJB');
    expect(formatUserCode('WDJBM')).toBe('WDJB-M');
  });

  it('nettoie avant de formater', () => {
    expect(formatUserCode('wdjb mjht')).toBe('WDJB-MJHT');
    expect(formatUserCode('')).toBe('');
  });
});

describe('isCompleteUserCode', () => {
  it('ne déclenche l’appel réseau qu’à huit caractères valides', () => {
    expect(isCompleteUserCode('WDJBMJH')).toBe(false);
    expect(isCompleteUserCode('WDJB-MJHT')).toBe(true);
    // Sept lettres et trois chiffres ne font pas un code complet : les
    // chiffres ne comptent pas.
    expect(isCompleteUserCode('WDJBMJH123')).toBe(false);
  });
});

describe('countdownParts', () => {
  it('découpe des secondes en minutes et secondes, en TEXTE', () => {
    // 🚨 Des chaînes, jamais des nombres : un nombre remis à next-intl passe
    // par Intl.NumberFormat, qui ne rend pas la même chose dans WebKit et dans
    // Node, et React casse alors sur la différence d'hydratation (règle 8).
    const p = countdownParts(812);
    expect(p).toEqual({ minutes: '13', seconds: '32' });
    expect(typeof p.minutes).toBe('string');
    expect(typeof p.seconds).toBe('string');
  });

  it('complète les secondes à deux chiffres pour que la ligne ne saute pas', () => {
    expect(countdownParts(69)).toEqual({ minutes: '1', seconds: '09' });
    expect(countdownParts(60)).toEqual({ minutes: '1', seconds: '00' });
  });

  it('ne descend jamais sous zéro, quoi qu’on lui donne', () => {
    expect(countdownParts(0)).toEqual({ minutes: '0', seconds: '00' });
    expect(countdownParts(-5)).toEqual({ minutes: '0', seconds: '00' });
    expect(countdownParts(Number.NaN)).toEqual({ minutes: '0', seconds: '00' });
    expect(countdownParts(Number.POSITIVE_INFINITY)).toEqual({ minutes: '0', seconds: '00' });
  });

  it('arrondit vers le bas plutôt que d’annoncer une seconde qui n’existe plus', () => {
    expect(countdownParts(59.9)).toEqual({ minutes: '0', seconds: '59' });
  });
});

/**
 * L'aiguillage des refus. Les libellés viennent du contrat de l'API, pas d'une
 * lecture du code : le module qui les produit est écrit en parallèle.
 */
describe('routeDeviceFailure', () => {
  it('rend le même verdict pour tout 404, parce que le corps est uniforme', () => {
    // Inconnu, expiré, déjà approuvé, déjà refusé : un seul corps et un seul
    // statut, exprès, pour ne pas donner d'oracle à un devineur. La page ne
    // peut donc pas dire « expiré » sans mentir une fois sur trois.
    expect(routeDeviceFailure(404, 'invalid_or_expired')).toEqual({ screen: 'invalid' });
    expect(routeDeviceFailure(404, undefined)).toEqual({ screen: 'invalid' });
  });

  it('demande une relance silencieuse sur un jeton périmé', () => {
    // Deuxième onglet, ou page laissée ouverte plus longtemps que le jeton :
    // ce n'est pas une erreur à montrer, c'est un lookup à rejouer une fois.
    expect(routeDeviceFailure(403, 'approval_token_required')).toEqual({ screen: 'stale' });
  });

  it('garde son écran propre au 429 d’une clé par adresse et par jour', () => {
    // Un 429 affiché comme une erreur générique laisserait l'humain devant un
    // mur alors que le bouton d'à côté — la clé sans adresse — marche.
    expect(routeDeviceFailure(429, 'key_rate_limited')).toEqual({
      screen: 'stay',
      notice: 'keyRateLimited',
    });
  });

  it('reste sur place et relaie le message de l’API pour tout le reste', () => {
    for (const error of [
      'disposable_email',
      'undeliverable_email',
      'verification_rate_limited',
      'verification_failed',
      'verification_unavailable',
      'unsupported_media_type',
      'quelque_chose_de_neuf',
    ]) {
      expect(routeDeviceFailure(400, error)).toEqual({ screen: 'stay', notice: 'apiMessage' });
    }
  });

  it('ne confond pas le 429 du plafond de clés avec un autre 429', () => {
    expect(routeDeviceFailure(429, 'verification_rate_limited')).toEqual({
      screen: 'stay',
      notice: 'apiMessage',
    });
  });
});

/**
 * Les textes que la page affiche existent dans les trois langues. Le test de
 * parité général le vérifie clé par clé ; celui-ci épingle le namespace par
 * son nom, parce qu'une page d'approbation qui montre `device.approveAnon` à
 * la place d'un bouton ne se rate pas à moitié.
 */
describe('les textes de la page', () => {
  const KEYS = [
    'title',
    'subtitle',
    'codeLabel',
    'whoLabel',
    'whyLabel',
    'whoUnknown',
    'whyUnknown',
    'expiresIn',
    'approveAnon',
    'approveAnonNote',
    'approveEmail',
    'approveEmailNote',
    'codeSent',
    'deny',
    'doneTitle',
    'doneBody',
    'deniedTitle',
    'expiredTitle',
    'expiredBody',
    'invalidTitle',
    'tokenStaleTitle',
    'tokenStaleBody',
    'keyRateLimitedTitle',
    'keyRateLimitedBody',
    'safetyNote',
  ];

  it.each([
    ['en', en],
    ['fr', fr],
    ['de', de],
  ])('%s porte les vingt-cinq clés du namespace device', (_name, tree) => {
    const ns = (tree as { device: Record<string, string> }).device;
    for (const key of KEYS) {
      expect(typeof ns[key], key).toBe('string');
      expect(ns[key].trim(), key).not.toBe('');
    }
    expect(Object.keys(ns).sort()).toEqual([...KEYS].sort());
  });

  it.each([
    ['en', en],
    ['fr', fr],
    ['de', de],
  ])('%s interpole les valeurs que le composant fournit', (_name, tree) => {
    const ns = (tree as { device: Record<string, string> }).device;
    // Les nombres viennent de l'API (25 et 200 aujourd'hui) : aucun n'est
    // écrit dans un texte, donc chaque libellé doit porter son {limit}.
    expect(ns.approveAnon).toContain('{limit}');
    expect(ns.approveEmail).toContain('{limit}');
    expect(ns.expiresIn).toContain('{minutes}');
    expect(ns.expiresIn).toContain('{seconds}');
  });

  it.each([
    ['en', en],
    ['fr', fr],
    ['de', de],
  ])('%s n’écrit aucun plafond en dur dans ces textes', (_name, tree) => {
    const ns = (tree as { device: Record<string, string> }).device;
    for (const [key, value] of Object.entries(ns)) {
      // Un 25 ou un 200 recopié dans une phrase survit au changement du
      // plafond et se met à mentir. Le 6 de « code à 6 chiffres » est une
      // propriété du code de vérification, pas un plafond.
      expect(/\b(25|200)\b/.test(value), `${key}: ${value}`).toBe(false);
    }
  });
});
