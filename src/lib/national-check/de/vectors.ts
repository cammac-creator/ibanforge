import type { DeVectors } from './vectors-types.js';
import { DE_VECTORS_00_39 } from './vectors-00-39.js';
import { DE_VECTORS_40_79 } from './vectors-40-79.js';
import { DE_VECTORS_80_A9 } from './vectors-80-a9.js';
import { DE_VECTORS_B0_E4 } from './vectors-b0-e4.js';

export type { DeVectorSet, DeVectors } from './vectors-types.js';

/** Tous les numéros de test officiels de la Bundesbank recopiés ici, par méthode. */
export const DE_OFFICIAL_VECTORS: DeVectors = Object.freeze({
  ...DE_VECTORS_00_39,
  ...DE_VECTORS_40_79,
  ...DE_VECTORS_80_A9,
  ...DE_VECTORS_B0_E4,
});
