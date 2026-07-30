import { defineConfig } from 'vitest/config';

// This file exists to stop vitest walking up to the repo root config.
//
// `mcp/` had no config, so vitest resolved the one at the root — written for
// vitest 3, against the API server. Its `include: ['src/**/*.test.ts']`
// happened to match `mcp/src/index.test.ts` relative to this directory, so the
// suite ran and looked fine. It was luck: change the root pattern and these
// tests stop running silently. The root's `poolOptions` also printed a vitest 4
// deprecation on every run here, noise from a setting that has nothing to do
// with this package.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The spawn of `dist/index.js` and the MCP handshake happen in `beforeAll`,
    // which already carries its own 30s. This raises the ceiling for the calls
    // themselves: they are round trips over stdio to a separate process, not
    // in-process assertions, and a cold CI runner is slower than it looks.
    testTimeout: 30_000,
  },
});
