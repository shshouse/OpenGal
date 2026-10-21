import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src/renderer/src'),
      '@shared': path.resolve(process.cwd(), 'src/shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: [
        'src/shared/**/*.ts',
        'src/renderer/src/features/pipeline/contextAssembler.ts',
        'src/renderer/src/features/memory/corpusBuffer.ts',
        'src/main/services/memoryStore.ts',
        'src/main/services/memoryDb.ts',
      ],
    },
  },
})
