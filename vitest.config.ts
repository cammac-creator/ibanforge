import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // scripts/ is included on purpose: the weekly report's window logic is
    // written here, and it is exactly the kind of code nobody opens for months
    // (a one-day comparison window published a huge jump on a flat week). Untested
    // scripts are still shipped behaviour.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // One private stats database per test file, set before the file's imports.
    //
    // History: the suite used to run serialised (`poolOptions.forks.singleFork`)
    // because many files assert "this counter moved by exactly 1" against the
    // SAME `data/stats.sqlite`. Vitest 4 removed that option and ignored it
    // silently: the files ran in parallel on one database, and a different
    // delta failed on every run. See test/hermetic-stats.ts (outside src/ on
    // purpose: the runtime-dependency guard reads src/ as production code, and
    // this file imports vitest).
    //
    // ⚠️ Never "repair" a delta that breaks by loosening it to
    // `toBeGreaterThanOrEqual`: the assertion would then guard nothing (it
    // would pass at 0 counted rejections as well as at 2, the two failures it
    // exists to catch). Look here first.
    setupFiles: ['test/hermetic-stats.ts'],
  },
});
