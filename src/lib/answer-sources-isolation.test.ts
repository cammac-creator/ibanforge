import { describe, it, expect, afterAll, vi } from 'vitest';

/**
 * `page_views_daily` (the visit counter, src/lib/page-views.ts) is held to the same rule,
 * and `web_events` (a time and a referring host per click) is named forbidden for it even
 * before that table's lazy creation: the counter and the click log are read separately.
 *
 * `answer_sources_daily` is never joined or crossed with a table that carries a
 * key, an IP address or a time (src/lib/answer-sources.ts, AGENTS.md). On a quiet
 * day a cell of 1 would otherwise tie a source family to a key prefix, which the
 * decision of 19 November 2026 ruled out.
 *
 * What this holds: no SQL string of `src/`, `scripts/` or `frontend/` names
 * `answer_sources_daily` together with such a table. The forbidden tables are
 * read from the schema the migration builds, not listed by hand, so a table
 * added tomorrow with a `key_prefix` or a `created_at` is covered the day it
 * lands. A script that reads the counter and another table in two separate
 * queries, then joins them in code, is not caught: the written rule covers it.
 */
const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-answer-sources-isolation-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getStatsDB } from './db.js';

afterAll(() => {
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${HERMETIC_DB}${suffix}`, { force: true });
});

const ROOT = join(import.meta.dirname, '..', '..');
const SELF = relative(ROOT, import.meta.filename);

/** A column that names a key, an e-mail, an IP address, an agent or a time. */
const IDENTIFYING_COLUMN =
  /key|email|ip_hash|^ip$|user_agent|agent_signature|wallet|created_at|_at$|^hour$|timestamp|^ts$/i;

const COUNTERS = ['answer_sources_daily', 'page_views_daily'] as const;
/** Tables that are created lazily, so the schema of a fresh database may not list them yet. */
const LAZY_FORBIDDEN = ['web_events'];

function forbiddenTables(): string[] {
  const db = getStatsDB();
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
      name: string;
    }>
  ).map((t) => t.name);
  const found = tables.filter((name) => {
    if ((COUNTERS as readonly string[]).includes(name) || name.startsWith('sqlite_')) return false;
    const cols = (db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    return cols.some((c) => IDENTIFYING_COLUMN.test(c));
  });
  return [...new Set([...found, ...LAZY_FORBIDDEN])];
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs|sql)$/.test(entry)) out.push(path);
  }
  return out;
}

/** Every string literal of a file: quotes, double quotes and template literals. */
const LITERAL = /`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;

describe.each(COUNTERS)('%s is never crossed with a table that identifies', (counter) => {
  const forbidden = forbiddenTables();

  it('reads the forbidden tables from the schema, operations and request_log among them', () => {
    expect(forbidden).toContain('operations');
    expect(forbidden).toContain('request_log');
    expect(forbidden).toContain('api_keys');
    // The counter itself carries none of those columns.
    expect(forbidden).not.toContain(counter);
  });

  it('no SQL string of src/, scripts/ or frontend/ names it together with one of them', () => {
    const offenders: string[] = [];
    let literalsNamingIt = 0;
    for (const top of ['src', 'scripts', 'frontend']) {
      for (const file of sourceFiles(join(ROOT, top))) {
        const rel = relative(ROOT, file);
        if (rel === SELF) continue;
        const text = readFileSync(file, 'utf8');
        if (!text.includes(counter)) continue;
        // A .sql file is one statement space.
        const chunks = file.endsWith('.sql') ? [text] : (text.match(LITERAL) ?? []);
        for (const chunk of chunks) {
          if (!chunk.includes(counter)) continue;
          literalsNamingIt += 1;
          for (const table of forbidden) {
            if (new RegExp(`\\b${table}\\b`).test(chunk)) offenders.push(`${rel}: ${table}`);
          }
        }
      }
    }
    // Not hollow: the writer, the reader and the migration are among the strings read.
    expect(literalsNamingIt).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });
});
