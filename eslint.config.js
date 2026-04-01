import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
];
