import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Le texte Pro servi par l'API (llms, 402) dit la date de mise en vigueur de la remise
// à zéro au jour anniversaire (28.12.2026, préavis des conditions §9) : sans elle, il
// serait faux pour un abonné actuel, qui repart le 1er jusqu'à sa bascule.
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const DATED = 'from the first renewal on or after December 28, 2026; on the 1st until then';

describe('texte Pro servi par l’API : la date de renouvellement est datée', () => {
  for (const file of ['app.ts', 'middleware/enrich-402.ts']) {
    it(file, () => {
      const text = read(file);
      expect(text).toContain(DATED);
      expect(text).not.toMatch(
        /resets? on your monthly renewal date(?! \(from the first renewal on or after December 28, 2026)/,
      );
    });
  }
});
