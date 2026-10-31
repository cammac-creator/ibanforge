import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * The self-hosted image must never write its page cache to the container's
 * disk (next.config.ts, isrFlushToDisk). Next's file-system cache has no
 * eviction: on the VPS it kept every register page in three languages until
 * the container was recreated. Builds that are not the self-hosted image
 * (Vercel, CI, next dev) keep Next's defaults.
 */
async function loadConfig(output: string | undefined) {
  vi.resetModules();
  if (output === undefined) vi.stubEnv('NEXT_OUTPUT', '');
  else vi.stubEnv('NEXT_OUTPUT', output);
  const mod = await import('../next.config');
  return mod.default as { output?: string; experimental?: { isrFlushToDisk?: boolean } };
}

describe('page cache of the self-hosted image', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps pages in memory only when built for the container', async () => {
    const config = await loadConfig('standalone');
    expect(config.output).toBe('standalone');
    expect(config.experimental?.isrFlushToDisk).toBe(false);
  });

  it('leaves the other builds on the defaults', async () => {
    const config = await loadConfig(undefined);
    expect(config.output).toBeUndefined();
    expect(config.experimental?.isrFlushToDisk).toBeUndefined();
  });

  /*
   * Without a disk copy, a pre-rendered page pushed out of memory is served
   * once from its build copy. The build of /status has no STATS_TOKEN and
   * shows dashes: that page must have no build copy at all.
   */
  it('renders /status on each visit, so no build copy of it can be served', () => {
    const source = readFileSync(resolve(__dirname, '../app/[locale]/status/page.tsx'), 'utf8');
    expect(source).toMatch(/^export const dynamic = "force-dynamic";$/m);
    expect(source).not.toMatch(/^export const revalidate\b/m);
  });

  /*
   * Rendered on each visit, a /health fetch kept in the data cache would time a
   * cache read and keep the last 200 on screen during an outage: the health
   * line goes through the probe (lib/status-health.test.ts tests its
   * behaviour), never through a cached fetch of /health.
   */
  it('reads the health of /status through the probe, not the data cache', () => {
    const source = readFileSync(resolve(__dirname, '../app/[locale]/status/page.tsx'), 'utf8');
    expect(source).toMatch(/createHealthProbe\(`\$\{API_URL\}\/health`\)/);
    expect(source).not.toMatch(/fetch\(`\$\{API_URL\}\/health`/);
  });
});
