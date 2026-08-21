import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    /**
     * frontend/ carries its own eslint config, its own plugin install and its
     * own `npm run lint`. Linting it from here loads eslint-plugin-react out of
     * the other node_modules and throws, so the two trees stay separate on
     * purpose. dist/ is build output: linting it reports the compiler's own
     * emit back at us.
     */
    ignores: [
      'dist/',
      '**/dist/',
      'node_modules/',
      '**/node_modules/',
      'coverage/',
      'frontend/',
      // Gitignored local tool that holds wallet material. It is not part of the
      // repository, so it is not part of the repository's checks.
      'scripts/x402-pay.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    /**
     * Every TypeScript file that ships or runs somewhere.
     *
     * 🚨 Until 21/08/2026 this list was `src/**` alone, so `npm run lint`
     * checked 186 files and left 32 unchecked: the 22 operational scripts, the
     * MCP package, the TypeScript kit PUBLISHED TO CUSTOMERS, and the n8n
     * connector. The published kit is the one that mattered most, because it is
     * code that runs on someone else's machine.
     */
    files: [
      'src/**/*.ts',
      'scripts/**/*.ts',
      'mcp/**/*.ts',
      'sdks/typescript/src/**/*.ts',
      'integrations/n8n/**/*.ts',
    ],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      /**
       * TypeScript resolves identifiers itself and knows which platform library
       * is in scope. `no-undef` only knows the globals it was handed, so on a
       * TypeScript file it reports `fetch`, `console` and `URLSearchParams` as
       * undefined — 70-odd false alarms the moment the four zones above were
       * added. Turning it off on TS files is the typescript-eslint maintainers'
       * own recommendation, and it removes nothing: tsc already catches a name
       * that does not exist.
       */
      'no-undef': 'off',
    },
  },
  {
    /**
     * The two plain-JavaScript scripts. `no-undef` IS meaningful here, since
     * nothing type-checks them, so the globals are declared rather than the
     * rule switched off. Kept to what these two files actually use: adding the
     * whole Node surface would let a genuine typo through.
     */
    /**
     * The CommonJS operational scripts. They are `.cjs` deliberately: they are
     * run by hand with `node`, one of them is the right-to-erasure tool the
     * privacy policy promises, and neither belongs in the module graph the
     * service builds. So `require` is correct here and the rule that forbids it
     * does not apply.
     */
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off', 'no-console': 'off' },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortController: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['src/db/seed.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
