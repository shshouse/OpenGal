import fs from 'node:fs'
import path from 'node:path'
import type { PluginInfo, PluginManifest, ToolDefinition } from '@shared/types'
import { McpSession } from './mcpHost'
import { validateManifest } from './manifest'
import { registerTool, unregisterTool } from '../tools'
import { logBus } from '../logBus'

let dataRoot = ''
let enabledMap: Record<string, boolean> = {}
const sessions = new Map<string, McpSession>()
const runtimeErrors = new Map<string, string>()

function pluginsDir(): string {
  return path.join(dataRoot, 'plugins')
}

function stateFile(): string {
  return path.join(dataRoot, 'plugins-state.json')
}

function loadState(): void {
  try {
    enabledMap = JSON.parse(fs.readFileSync(stateFile(), 'utf-8')) as Record<string, boolean>
  } catch {
    enabledMap = {}
  }
}

function saveState(): void {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(enabledMap, null, 2))
  } catch { /* 状态写失败不影响主流程 */ }
}

function readManifest(id: string): PluginManifest {
  const manifestPath = path.join(pluginsDir(), id, 'manifest.json')
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as unknown
  const v = validateManifest(raw, id)
  if (!v.ok) throw new Error(v.errors.join('；'))
  return v.manifest
}

function toToolDef(fullName: string, name: string, description?: string, inputSchema?: unknown): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: fullName,
      description: description || name,
      parameters:
        inputSchema && typeof inputSchema === 'object'
          ? (inputSchema as Record<string, unknown>)
          : { type: 'object', properties: {} },
    },
  }
}

function brokenInfo(dir: string, message: string): PluginInfo {
  return {
    id: dir,
    name: dir,
    version: '',
    enabled: false,
    status: 'error',
    errorMessage: message,
    mcpTools: [],
    widgetCount: 0,
  }
}

export function initPlugins(root: string): void {
  dataRoot = root
  loadState()
  void restoreEnabled()
}

async function restoreEnabled(): Promise<void> {
  for (const info of scanPlugins()) {
    if (info.enabled) {
      await setPluginEnabled(info.id, true).catch((err: Error) => {
        logBus.error('plugins', `插件 ${info.id} 启动失败`, err.message)
      })
    }
  }
}

export function scanPlugins(): PluginInfo[] {
  const out: PluginInfo[] = []
  let dirs: fs.Dirent[]
  try {
    dirs = fs.readdirSync(pluginsDir(), { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return out
  }
  for (const d of dirs) {
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(path.join(pluginsDir(), d.name, 'manifest.json'), 'utf-8'))
    } catch {
      out.push(brokenInfo(d.name, 'manifest.json 缺失或不是合法 JSON'))
      continue
    }
    const v = validateManifest(raw, d.name)
    if (!v.ok) {
      out.push(brokenInfo(d.name, v.errors.join('；')))
      continue
    }
    const m = v.manifest
    const enabled = enabledMap[m.id] === true
    const toolNames: string[] = []
    for (const [key, s] of sessions) {
      if (key.startsWith(`${m.id}/`)) {
        for (const t of s.toolDefs) toolNames.push(s.toolFullName(t.name))
      }
    }
    out.push({
      id: m.id,
      name: m.name,
      version: m.version,
      author: m.author,
      description: m.description,
      enabled,
      status: runtimeErrors.has(m.id) ? 'error' : enabled ? 'enabled' : 'disabled',
      errorMessage: runtimeErrors.get(m.id),
      mcpTools: toolNames,
      widgetCount: m.contributions?.widgets?.length ?? 0,
    })
  }
  return out
}

export function stopPluginSessions(pluginId: string): void {
  for (const [key, s] of [...sessions]) {
    if (!key.startsWith(`${pluginId}/`)) continue
    for (const t of s.toolDefs) unregisterTool(s.toolFullName(t.name))
    s.stop()
    sessions.delete(key)
  }
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  if (enabled) {
    const m = readManifest(pluginId)
    const servers = m.contributions?.mcpServers ?? []
    const started: McpSession[] = []
    try {
      for (const cfg of servers) {
        const s = new McpSession(cfg, pluginId, (level, msg, detail) => logBus[level]('plugins', msg, detail))
        await s.start()
        started.push(s)
        sessions.set(`${pluginId}/${cfg.id}`, s)
        for (const t of s.toolDefs) {
          const raw = t.name
          registerTool(toToolDef(s.toolFullName(raw), raw, t.description, t.inputSchema), (args) =>
            s.callTool(raw, args),
          )
        }
        logBus.info('plugins', `插件 ${pluginId} 工具服务 ${cfg.id} 就绪，注册 ${s.toolDefs.length} 个工具`)
      }
    } catch (err) {
      for (const s of started) s.stop()
      for (const cfg of servers) sessions.delete(`${pluginId}/${cfg.id}`)
      runtimeErrors.set(pluginId, (err as Error).message)
      saveState()
      throw err
    }
    runtimeErrors.delete(pluginId)
  } else {
    stopPluginSessions(pluginId)
    runtimeErrors.delete(pluginId)
    logBus.info('plugins', `插件 ${pluginId} 已禁用`)
  }
  enabledMap[pluginId] = enabled
  saveState()
}

export function rescanPlugins(): PluginInfo[] {
  const ids = new Set(scanPlugins().map((p) => p.id))
  for (const key of [...sessions.keys()]) {
    const pid = key.split('/')[0]
    if (!ids.has(pid)) {
      stopPluginSessions(pid)
      logBus.warn('plugins', `插件 ${pid} 目录已不存在，停止其工具服务`)
    }
  }
  return scanPlugins()
}

export function shutdownPlugins(): void {
  for (const [, s] of sessions) s.stop()
  sessions.clear()
}
