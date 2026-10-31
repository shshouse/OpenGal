import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'release/**',
      'node_modules/**',
      'mods/**',
      'data/**',
      'tmp/**',
      '.tmp/**',
      '.venv-asr/**',
      '.venv-asr312/**',
      'public/**',
      'resources/**',
      'src/renderer/public/**',
      'coverage/**',
      'tests/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  // 类型感知规则：只作用于 tsconfig 覆盖的源码，lint 从 3s 升到约 12s
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: ['./config/tsconfig.node.json', './config/tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname + '/..',
      },
    },
    rules: {
      // TS 自身负责未定义变量检查，重复执行只会误报
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',

      // 异步失败不能静默
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],

      // 不可信输入不能 String() 成 "[object Object]" 后继续执行
      '@typescript-eslint/no-base-to-string': 'error',

      // 空 catch 必须写明为什么可以忽略（规则本身放行带注释的块）
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  // 以下都不在 tsconfig 覆盖内：只做语法检查
  {
    files: ['src/scripts/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
    rules: { 'no-undef': 'off', ...tseslint.configs.disableTypeChecked.rules },
  },
  {
    files: ['**/*.mjs', 'config/**/*.ts', '*.config.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-undef': 'off', ...tseslint.configs.disableTypeChecked.rules },
  },
  {
    files: ['tests/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-undef': 'off', ...tseslint.configs.disableTypeChecked.rules },
  },
)
