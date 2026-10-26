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
      include: [
        'src/shared/**/*.ts',
        'src/main/services/memoryStore.ts',
        'src/main/services/memoryDb.ts',
        'src/main/services/ttsPort.ts',
        'src/main/services/plugins/manifest.ts',
        'src/renderer/src/features/pipeline/contextAssembler.ts',
        'src/renderer/src/features/pipeline/subtitles.ts',
        'src/renderer/src/features/memory/corpusBuffer.ts',
      ],
    },
  },
})
