import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

// flat/recommended registers the TypeScript parser and rules that don't need
// full type information. We get deeper type safety from `npm run typecheck`
// (tsc --noEmit), which already runs in CI. Mixing type-aware ESLint rules with
// a JS config file (this file itself) requires awkward workarounds, so we keep
// the linter configuration simple.
export default [
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  {
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      // Disable formatting rules that conflict with Prettier, then enforce Prettier itself.
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      // The architecture rule: no `any` keeps the type system honest.
      '@typescript-eslint/no-explicit-any': 'error',
      // Allow _-prefixed parameters that are intentionally unused
      // (e.g. interface implementations where we must accept a parameter we don't read).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
