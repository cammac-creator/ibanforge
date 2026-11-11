import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE } from './error-handler.js';

/**
 * Depuis la PR 609, un 500 imprévu est du JSON (`{ error: 'internal_error',
 * message }`, `src/lib/error-handler.ts`). La page des erreurs du site disait
 * encore, dans les trois langues, que le corps d'un 500 est le texte brut
 * `Internal Server Error`, sans enveloppe JSON (C23, 11.11.2026). Ce test lit
 * les trois pages et les tient au corps réel.
 */
const ROOT = join(import.meta.dirname, '..', '..');

describe('la page des erreurs du site décrit le 500 tel que l’API le rend', () => {
  it.each(['en', 'fr', 'de'])('%s', (locale) => {
    const text = readFileSync(join(ROOT, 'frontend/content', locale, 'docs/errors.mdx'), 'utf8');
    const section = text.slice(
      text.indexOf('### 500'),
      text.indexOf('\n## ', text.indexOf('### 500')),
    );
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain(`"error": "${INTERNAL_ERROR}"`);
    expect(section).toContain(`"message": "${INTERNAL_ERROR_MESSAGE}"`);
    expect(section).not.toMatch(/plain text|texte brut|reine Text|`Internal Server Error`/);
  });
});
