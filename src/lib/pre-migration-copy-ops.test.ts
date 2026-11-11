/**
 * Le câblage de la copie d'avant migration à l'exploitation (C18) : l'alerte du démarrage,
 * la purge quotidienne, et leur appel par src/index.ts.
 *
 * Les alertes passent par le vrai `opsFail`/`opsOk`, Telegram simulé : on compte les
 * messages qui partiraient.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PRE_MIGRATION_PURGE_ALERT_KEY,
  purgePreMigrationCopiesTick,
  reportPreMigrationCopy,
} from './pre-migration-copy-ops.js';
import { PRE_MIGRATION_COPY_ALERT_KEY } from './pre-migration-copy.js';
import { getStatsDB } from './db.js';

const ENV = {
  tok: process.env.TELEGRAM_BOT_TOKEN,
  chat: process.env.TELEGRAM_CHAT_ID,
  off: process.env.OPS_ALERTS_DISABLED,
};
let sent: string[] = [];

beforeEach(() => {
  sent = [];
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = '42';
  delete process.env.OPS_ALERTS_DISABLED;
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    sent.push((JSON.parse(init.body) as { text: string }).text);
    return { ok: true, status: 200 } as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of [PRE_MIGRATION_COPY_ALERT_KEY, PRE_MIGRATION_PURGE_ALERT_KEY]) {
    try {
      getStatsDB().prepare('DELETE FROM kv_state WHERE key LIKE ?').run(`ops:%:${key}`);
    } catch {
      /* table absente : rien à nettoyer */
    }
  }
  for (const [k, v] of [
    ['TELEGRAM_BOT_TOKEN', ENV.tok],
    ['TELEGRAM_CHAT_ID', ENV.chat],
    ['OPS_ALERTS_DISABLED', ENV.off],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('l’alerte du démarrage', () => {
  it('une migration passée sans copie alerte, une fois, puis se referme au démarrage suivant', async () => {
    await reportPreMigrationCopy(true, { status: 'failed', error: 'disque indisponible' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(PRE_MIGRATION_COPY_ALERT_KEY);
    expect(sent[0]).toContain('SANS copie préalable');

    await reportPreMigrationCopy(true, {
      status: 'copied',
      file: 'stats.pre-migration-1.0.0-20261110T080000.000Z.sqlite',
      bytes: 1_048_576,
      ms: 12,
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/résolu/);
  });

  it('sans alerte ouverte, une copie faite ou inutile ne dit rien', async () => {
    await reportPreMigrationCopy(true, { status: 'not_needed' });
    await reportPreMigrationCopy(true, {
      status: 'copied',
      file: 'stats.pre-migration-1.0.0-20261110T080000.000Z.sqlite',
      bytes: 1,
      ms: 1,
    });
    expect(sent).toEqual([]);
  });

  it('la borne de taille dépassée alerte aussi', async () => {
    await reportPreMigrationCopy(true, {
      status: 'skipped_too_large',
      paid_state_bytes: 200 * 1_048_576,
      max_bytes: 64 * 1_048_576,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('au-delà de la borne');
  });
});

describe('la purge quotidienne des copies', () => {
  it('deux jours sans pouvoir effacer une copie alertent, puis la guérison se dit', async () => {
    const stuck = () => ({ removed: [], failed: ['stats.pre-migration-x.sqlite'] });
    await purgePreMigrationCopiesTick(stuck);
    expect(sent).toEqual([]);
    await purgePreMigrationCopiesTick(stuck);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(PRE_MIGRATION_PURGE_ALERT_KEY);
    await purgePreMigrationCopiesTick(() => ({
      removed: ['stats.pre-migration-x.sqlite'],
      failed: [],
    }));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/résolu/);
  });

  it('une purge qui jette ne jette pas plus loin', async () => {
    const broken = () => {
      throw new Error('dossier illisible');
    };
    await expect(purgePreMigrationCopiesTick(broken)).resolves.toBeUndefined();
    await expect(purgePreMigrationCopiesTick(broken)).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('dossier illisible');
  });
});

describe('le câblage dans src/index.ts', () => {
  const entry = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

  it('dit la copie au démarrage, juste après l’ouverture de la base', () => {
    const open = entry.indexOf('const statsState = initStatsDB();');
    const report = entry.indexOf('void reportPreMigrationCopy(statsState.ok);');
    expect(open).toBeGreaterThan(-1);
    expect(report).toBeGreaterThan(open);
    // Avant le port : la copie se fait à l'ouverture, son compte rendu suit sans attendre.
    expect(report).toBeLessThan(entry.indexOf('serve({'));
  });

  it('purge les copies chaque jour, dans son propre minuteur', () => {
    expect(entry).toMatch(
      /setInterval\(\(\) => void purgePreMigrationCopiesTick\(\), 24 \* 60 \* 60 \* 1000\)\.unref\(\);/,
    );
  });
});
