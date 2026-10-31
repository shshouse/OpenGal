import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src/renderer/src'),
      '@shared': path.resolve(process.cwd(), 'src/shared'),
      'node:sqlite': path.resolve(process.cwd(), 'tests/support/sqlite.ts'),
      // Vite 会把 node: 前缀剥掉再解析，裸 sqlite 也要指向替身，否则测试无法启动
      sqlite: path.resolve(process.cwd(), 'tests/support/sqlite.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // 全量统计：分母是全部源码行，不是「测试恰好加载过的文件」。
      // 白名单会让未测试的模块根本不出现在报告里，数字虚高。
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/renderer/public/**',
        'src/scripts/**',
        'src/main/types/**',
        '**/*.d.ts',
      ],
    },
  },
})
