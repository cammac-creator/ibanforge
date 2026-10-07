import type { DeMethod } from './kernel.js';
import { DE_METHODS_00_39 } from './methods-00-39.js';
import { DE_METHODS_40_79 } from './methods-40-79.js';
import { DE_METHODS_80_A9 } from './methods-80-a9.js';
import { DE_METHODS_B0_E4 } from './methods-b0-e4.js';

/**
 * Toutes les méthodes écrites ici, par code de la Bundesbank (« 00 » à « E4 »).
 *
 * Écrite ne veut pas dire servie : `DE_VERIFIED_METHODS` (verified.ts) dit
 * lesquelles donnent un verdict.
 */
export const DE_METHODS: Readonly<Record<string, DeMethod>> = Object.freeze({
  ...DE_METHODS_00_39,
  ...DE_METHODS_40_79,
  ...DE_METHODS_80_A9,
  ...DE_METHODS_B0_E4,
});
