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
});
