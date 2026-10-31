/**
 * 文件端口。
 *
 * 路径一律是字符串；移动端映射到沙箱目录，不暴露 URL 或 Path 类型。
 */
export interface FileStat {
  size: number
  mtimeMs: number
  isDirectory: boolean
}

export interface ListOptions {
  recursive?: boolean
}

export interface RemoveOptions {
  recursive?: boolean
}

export interface FileStore {
  dataDir(): string
  tempDir(): string
  resolve(...parts: string[]): string
  readText(path: string): Promise<string>
  readBytes(path: string): Promise<Uint8Array>
  writeText(path: string, data: string): Promise<void>
  writeBytes(path: string, data: Uint8Array): Promise<void>
  appendText(path: string, data: string): Promise<void>
  /** 同目录临时文件 + rename，避免半写文件 */
  atomicWrite(path: string, data: string | Uint8Array): Promise<void>
  remove(path: string, options?: RemoveOptions): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** 不存在返回 null */
  stat(path: string): Promise<FileStat | null>
  /** 目录不存在返回空数组；结果为绝对路径 */
  list(dir: string, options?: ListOptions): Promise<string[]>
}
