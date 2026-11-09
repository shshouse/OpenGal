import fs from 'node:fs'
import path from 'node:path'

export interface ConfigDirResult {
  dir: string
  migrated: boolean
  error?: string
}

/**
 * 配置是小型偏好：优先用户 AppData；首次启动从旧的 data 目录复制一份，旧文件保留。
 * 复制失败时回退旧目录，保证应用仍能启动。
 */
export function resolveConfigDir(preferredDir: string, legacyDir: string): ConfigDirResult {
  const target = path.join(preferredDir, 'opengal-config.json')
  if (fs.existsSync(target)) return { dir: preferredDir, migrated: false }

  const legacy = path.join(legacyDir, 'opengal-config.json')
  if (!fs.existsSync(legacy)) return { dir: preferredDir, migrated: false }

  try {
    fs.mkdirSync(preferredDir, { recursive: true })
    fs.copyFileSync(legacy, target)
    return { dir: preferredDir, migrated: true }
  } catch (error) {
    return {
      dir: legacyDir,
      migrated: false,
      error: (error as Error).message,
    }
  }
}
