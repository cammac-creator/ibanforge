import { defineConfig } from 'vitest/config';

// Local config so `vitest run` in this package does NOT walk up and pick up the
// repo-root vitest.config.ts — which resolves `vitest/config` from the root
// node_modules and breaks the SDK-only CI job (where only sdks/typescript deps
// are installed). Keeps the SDK test run self-contained.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
