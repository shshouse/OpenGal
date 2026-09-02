import { spawn, ChildProcess } from 'node:child_process'
import type { McpServerManifest } from '@shared/types'

export type McpLogFn = (level: 'info' | 'warn' | 'error', msg: string, detail?: string) => void

export interface McpToolDef {
  name: string
  description?: string
  inputSchema?: unknown
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

const MIN_ENV_KEYS = [
  'PATH',
  'PATHEXT',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
]

export class McpSession {
  private child: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private lineBuf = ''
  private tools: McpToolDef[] = []
  private restartFailures = 0
  private config: McpServerManifest
  private pluginId: string
  private log: McpLogFn

  constructor(config: McpServerManifest, pluginId: string, log: McpLogFn) {
    this.config = config
    this.pluginId = pluginId
    this.log = log
  }

  toolFullName(rawName: string): string {
    return `mcp__${this.pluginId}__${this.config.id}__${rawName}`
  }

  get toolDefs(): McpToolDef[] {
    return this.tools
  }

  isAlive(): boolean {
    return this.child !== null && this.child.exitCode === null
  }

  async start(): Promise<void> {
    if (this.config.transport === 'http') {
      await this.handshake()
      return
    }
    const env: Record<string, string> = {}
    for (const k of MIN_ENV_KEYS) {
      const v = process.env[k]
      if (v !== undefined) env[k] = v
    }
    Object.assign(env, this.config.env ?? {})
    this.child = spawn(this.config.command!, this.config.args ?? [], {
      env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stdout!.setEncoding('utf-8')
    this.child.stdout!.on('data', (chunk: string) => {
      this.lineBuf += chunk
      const lines = this.lineBuf.split('\n')
      this.lineBuf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (t) this.handleLine(t)
      }
    })
    this.child.stderr?.setEncoding('utf-8')
    this.child.stderr?.on('data', (chunk: string) => {
      this.log('info', `mcp[${this.tag()}] ${chunk.trim().slice(0, 400)}`)
    })
    this.child.on('exit', (code, signal) => {
      this.failPending(`MCP ${this.tag()} 子进程退出(code=${code} signal=${signal})`)
      if (code !== 0 && !signal) {
        this.log('warn', `mcp[${this.tag()}] 异常退出 code=${code}`)
      }
    })
    this.child.on('error', (err) => {
      this.failPending(`MCP ${this.tag()} 进程错误: ${err.message}`)
    })
    await this.handshake()
    this.restartFailures = 0
  }

  private tag(): string {
    return `${this.pluginId}/${this.config.id}`
  }

  private async handshake(): Promise<void> {
    await this.sendRequest(
      'initialize',
      {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'opengal', version: '0.1' },
      },
      15_000,
    )
    this.sendNotification('notifications/initialized')
    const listResult = (await this.sendRequest('tools/list', {}, 15_000)) as {
      tools?: McpToolDef[]
    }
    this.tools = listResult.tools ?? []
  }

  async callTool(rawName: string, args: Record<string, unknown>): Promise<string> {
    if (this.config.transport === 'stdio' && !this.isAlive()) {
      this.restartFailures += 1
      if (this.restartFailures > 3) {
        throw new Error(`MCP ${this.tag()} 连续重启失败，请禁用后重新启用`)
      }
      this.log('warn', `mcp[${this.tag()}] 连接已断，尝试重启`)
      await this.start()
    }
    const result = (await this.sendRequest(
      'tools/call',
      { name: rawName, arguments: args },
      this.config.timeoutMs ?? 60_000,
    )) as { content?: Array<{ type: string; text?: string }>; isError?: boolean }
    const text = (result.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim()
    if (result.isError) throw new Error(text || 'MCP 工具返回错误')
    this.restartFailures = 0
    return text
  }

  stop(): void {
    this.failPending(`MCP ${this.tag()} 已停止`)
    const c = this.child
    this.child = null
    this.tools = []
    if (c && c.exitCode === null && c.pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(c.pid), '/f', '/t'], { windowsHide: true })
        } else {
          c.kill('SIGTERM')
        }
      } catch { /* already dead */ }
    }
    try {
      c?.stdin?.destroy()
    } catch { /* already closed */ }
  }

  private failPending(msg: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(msg))
    }
    this.pending.clear()
  }

  private sendNotification(method: string): void {
    const msg = { jsonrpc: '2.0' as const, method }
    if (this.config.transport === 'http') {
      void fetch(this.config.url!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      }).catch(() => {})
      return
    }
    this.child?.stdin?.write(JSON.stringify(msg) + '\n')
  }

  private sendRequest(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++
    const msg = { jsonrpc: '2.0' as const, id, method, params }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${method} 超时(${timeoutMs}ms)`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      if (this.config.transport === 'http') {
        fetch(this.config.url!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg),
        })
          .then((r) => r.json())
          .then((res: { error?: { message?: string }; result?: unknown }) => {
            this.pending.delete(id)
            clearTimeout(timer)
            if (res.error) reject(new Error(res.error.message ?? 'MCP error'))
            else resolve(res.result)
          })
          .catch((err: Error) => {
            this.pending.delete(id)
            clearTimeout(timer)
            reject(err)
          })
      } else {
        if (!this.child?.stdin?.writable) {
          this.pending.delete(id)
          clearTimeout(timer)
          reject(new Error(`MCP ${this.tag()} stdin 不可写`))
          return
        }
        this.child.stdin.write(JSON.stringify(msg) + '\n')
      }
    })
  }

  private handleLine(line: string): void {
    let msg: { id?: number; method?: string; error?: { message?: string }; result?: unknown }
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.method !== undefined) return
    if (typeof msg.id !== 'number') return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.error) p.reject(new Error(msg.error.message ?? 'MCP error'))
    else p.resolve(msg.result)
  }
}
