import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Permet `const { passwordHash, ...rest } = user` i noms `_q` / `__v`.
      'no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['tests/**/*.js', '**/*.test.js', '**/*.integration.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
];
