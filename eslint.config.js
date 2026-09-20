import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'experiments/output/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['packages/sim/**/*.ts'],
    rules: {
      // The sim must stay pure and deterministic.
      'no-restricted-globals': ['error', 'window', 'document', 'process', 'console'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG.' },
        { object: 'Date', property: 'now', message: 'The sim must not read the clock.' },
      ],
    },
  },
);
