import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../tests/dashboard/contrast-helper';

describe('contraste calculé à partir des couleurs effectives', () => {
  it('retrouve les bornes noir/blanc et couleur identique', () => {
    expect(contrastRatio([0, 0, 0, 255], [255, 255, 255])).toBe(21);
    expect(contrastRatio([255, 255, 255, 255], [0, 0, 0])).toBe(21);
    expect(contrastRatio([80, 100, 90, 255], [80, 100, 90])).toBe(1);
  });
  it('ne fait pas passer le gris #777 sur blanc par un arrondi à 4,5', () => {
    const ratio = contrastRatio([119, 119, 119, 255], [255, 255, 255]);
    expect(ratio).toBeCloseTo(4.478089, 6); expect(ratio).toBeLessThan(4.5);
  });
  it('compose la transparence du texte sur son vrai fond', () => {
    expect(contrastRatio([0, 0, 0, 0], [255, 255, 255])).toBe(1);
    expect(contrastRatio([0, 0, 0, 128], [255, 255, 255])).toBeCloseTo(4.004107, 6);
  });
  it('refuse une couleur absente, non finie ou hors domaine', () => {
    for (const color of [[], [0, 0, 0], [NaN, 0, 0, 255], [0, 0, 256, 255]]) {
      expect(() => contrastRatio(color, [255, 255, 255])).toThrow();
    }
  });
});
