// TENQ の ESLint 設定。型チェック（tsc）で拾えない書き方の誤りを見る
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['app/**', '**/dist/**', '**/node_modules/**', '**/.wrangler/**', 'q/**', '_mock-*.html', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // 利用者の入力を HTML として埋め込まない（security.md §4）
      'no-restricted-properties': ['error', { property: 'innerHTML', message: 'innerHTML は使わない（XSS 対策）' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-syntax': ['error', { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'dangerouslySetInnerHTML は使わない（XSS 対策）' }],
    },
  },
  {
    files: ['api/test/**/*.ts', 'e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}', 'api/vitest.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
