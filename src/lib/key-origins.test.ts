import { describe, it, expect } from 'vitest';
import {
  isDoorOrigin,
  KEY_ORIGIN_DOORS,
  KEY_ORIGIN_TAGS,
  knownOrigins,
  normalizeOrigin,
  ORIGIN_SHAPE,
} from './key-origins.js';

describe('le vocabulaire des origines', () => {
  it('chaque nom publié passe la validation de la route', () => {
    for (const name of knownOrigins()) {
      expect(ORIGIN_SHAPE.test(name), name).toBe(true);
    }
  });

  it('un nom composé reste stockable, un deux-points ne l’est pas', () => {
    // Le piège que ce test ferme : un deux-points échoue la validation, la
    // route rend la porte au lieu de l'étiquette, et la campagne disparaît sans
    // erreur nulle part. Les noms composés sont donc TOUJOURS à tirets.
    expect(ORIGIN_SHAPE.test('mcp-registry')).toBe(true);
    expect(ORIGIN_SHAPE.test('place-de-marche:smithery')).toBe(false);
  });

  it('les portes et les étiquettes ne se recouvrent pas', () => {
    const doors = Object.keys(KEY_ORIGIN_DOORS);
    const tags = Object.keys(KEY_ORIGIN_TAGS);
    expect(doors.filter((d) => tags.includes(d))).toEqual([]);
  });

  it('une porte est une porte, une étiquette ne l’est pas', () => {
    expect(isDoorOrigin('site-signup')).toBe(true);
    expect(isDoorOrigin('stripe-pack')).toBe(true);
    // 🚨 `api-trial` est une ÉTIQUETTE portée par un lien sortant, pas une
    // porte : le tableau de bord lit le canal `src:api-trial` pour compter les
    // conversions de l'essai sans clé. La classer porte la ferait passer
    // derrière le référent et le compteur tomberait à zéro sans rien casser.
    expect(isDoorOrigin('api-trial')).toBe(false);
    expect(isDoorOrigin('npm')).toBe(false);
    expect(isDoorOrigin(null)).toBe(false);
    expect(isDoorOrigin(undefined)).toBe(false);
  });

  it('normalise, et retombe sur la porte plutôt que sur le vide', () => {
    expect(normalizeOrigin('  NPM ', 'site-signup')).toBe('npm');
    expect(normalizeOrigin('mcp-registry', 'site-signup')).toBe('mcp-registry');
    expect(normalizeOrigin('pas valide !', 'site-signup')).toBe('site-signup');
    expect(normalizeOrigin('', 'api-direct')).toBe('api-direct');
    expect(normalizeOrigin(undefined, 'api-direct')).toBe('api-direct');
    expect(normalizeOrigin(42, 'admin')).toBe('admin');
    expect(normalizeOrigin('x'.repeat(41), 'admin')).toBe('admin');
  });
});
