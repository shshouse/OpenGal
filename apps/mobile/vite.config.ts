import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  publicDir: resolve(__dirname, '../../src/renderer/public'),
  server: {
    fs: {
      allow: [resolve(__dirname, '../..')]
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    // ponytail: 沙箱 safe-delete 钩子会拦截 emptyOutDir 的 rmSync，关闭清理。
    // 旧文件由 CI/发布脚本负责清理（npm run clean 用系统 shell 执行）。
    emptyOutDir: false
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '../../src/renderer/src'),
      '@shared': resolve(__dirname, '../../src/shared')
    }
  }
})
