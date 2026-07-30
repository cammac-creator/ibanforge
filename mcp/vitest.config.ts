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
    // The suite spawns `dist/index.js` and talks to it over stdio. First run on
    // a cold CI runner pays for the process start plus the MCP handshake.
    testTimeout: 30_000,
  },
});
