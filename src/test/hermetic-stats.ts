/**
 * One stats database per test file.
 *
 * Runs before every test file (vitest `setupFiles`), inside the fresh worker
 * that file gets, so `src/lib/db.ts`, which reads STATS_DB_PATH once at import,
 * opens a private, empty `stats.sqlite` for that file alone. The schema is the
 * one db.ts creates on open, the same one production runs; the only thing a
 * file no longer shares is the ROWS of every other file.
 *
 * Why this exists: until Vitest 4 the suite ran serialised through
 * `poolOptions.forks.singleFork`, so that the many "this counter moved by
 * exactly 1" assertions could share `data/stats.sqlite`. Vitest 4 removed that
 * option and ignored it silently; the files ran in parallel on one database
 * and a different delta assertion failed on every run (03/09/2026, three runs,
 * three different failures, none reproducible alone). Eleven files had already
 * solved it for themselves with a hoisted STATS_DB_PATH; this makes it the
 * rule for all of them.
 *
 * A file that sets its own STATS_DB_PATH (the hoisted idiom) keeps it, and
 * keeps its own cleanup.
 */
import { afterAll } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const owned = !process.env.STATS_DB_PATH;
if (owned) {
  process.env.STATS_DB_PATH = join(tmpdir(), `ibf-stats-${process.pid}-${randomUUID()}.sqlite`);
}

afterAll(() => {
  if (!owned) return;
  const path = process.env.STATS_DB_PATH as string;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(path + suffix);
    } catch {
      /* already gone */
    }
  }
});
