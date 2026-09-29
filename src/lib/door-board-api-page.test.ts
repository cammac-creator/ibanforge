import { beforeEach, describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import { DOOR_LABELS_FR, OTHER_DOOR, doorLabel, doorOf, getDoorBoard } from './door-board.js';
import { isDoorOrigin, normalizeOrigin } from './key-origins.js';
import { normalizeEmail } from './email-norm.js';

/**
 * The door of the IBAN validation API page (29/09/2026).
 *
 * The page `/iban-validation-api` (and its French and German versions) opens
 * the same key dialog as every other page; `frontend/lib/key-origin.ts` sends
 * `site-api-page` as the key's origin when the visit carries no campaign tag.
 * A name the API vocabulary does not know would be stored and then counted as
 * "(autre)" on the board, which is exactly how a door stops being measured. In
 * its own file so that another door added beside it touches no shared test.
 *
 * Synthetic database (test/hermetic-stats.ts) and a fixed clock, invented
 * fixtures only: this repository is public.
 */
const NOW = Date.parse('2026-10-07T10:00:00Z');

let seq = 0;

function mint(created: string, source: string): void {
  seq += 1;
  const n = seq;
  const hash = `api-page-hash-${n}`;
  getStatsDB()
    .prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, created_at, source, tier,
                             monthly_limit, issued_by_us, no_recredit, lineage_hash)
       VALUES (?, ?, ?, ?, ?, ?, 'email', NULL, 0, 0, ?)`,
    )
    .run(
      hash,
      `ifk_ap${String(n).padStart(9, '0')}`,
      `person${n}@alpha.example.net`,
      normalizeEmail(`person${n}@alpha.example.net`),
      created.slice(0, 19).replace('T', ' '),
      source,
      hash,
    );
}

beforeEach(() => {
  const db = getStatsDB();
  for (const table of ['api_keys', 'lineage_facts', 'request_log', 'key_creations']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('la porte de la page « API de validation IBAN »', () => {
  it('est une porte du vocabulaire, pas une étiquette de campagne', () => {
    expect(isDoorOrigin('site-api-page')).toBe(true);
    expect(normalizeOrigin('site-api-page', 'site-signup')).toBe('site-api-page');
  });

  it('se range sous son propre nom, avec son libellé français', () => {
    expect(doorOf('site-api-page')).toBe('site-api-page');
    expect(doorOf('site-api-page')).not.toBe(OTHER_DOOR);
    expect(DOOR_LABELS_FR['site-api-page']).toBeTruthy();
    expect(doorLabel('site-api-page')).toBe(DOOR_LABELS_FR['site-api-page']);
  });

  it('apparaît dans le tableau des portes quand une clé naît par elle', () => {
    mint('2026-09-29T08:00:00Z', 'site-api-page');
    mint('2026-09-29T09:00:00Z', 'site-docs');
    const board = getDoorBoard({ now: NOW });
    const week40 = board.weeks.find((w) => w.key === '2026-W40');
    expect(week40).toBeDefined();
    const door = week40!.doors.find((d) => d.door === 'site-api-page');
    expect(door).toMatchObject({ created: 1, label: DOOR_LABELS_FR['site-api-page'] });
    expect(board.by_door.map((d) => d.door)).toContain('site-api-page');
  });
});
