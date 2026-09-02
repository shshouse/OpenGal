import type { PluginManifest } from '@shared/types'

export const PLUGIN_ID_RE = /^[a-z0-9-]{2,32}$/

export const KNOWN_PERMISSIONS = new Set([
  'events',
  'storage',
  'llm:chat',
  'screen',
  'history:read',
])

export function validateManifest(
  raw: unknown,
  dirName: string,
): { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['manifest 不是合法 JSON 对象'] }
  }
  const m = raw as PluginManifest
  const errors: string[] = []
  if (m.formatVersion !== 1) {
    errors.push(`formatVersion 必须为 1，当前 ${JSON.stringify(m.formatVersion)}（更高版本需新版 OpenGal）`)
  }
  if (typeof m.id !== 'string' || !PLUGIN_ID_RE.test(m.id)) {
    errors.push(`id 不合法：${JSON.stringify(m.id)}（规则 [a-z0-9-]{2,32}）`)
  } else if (m.id !== dirName) {
    errors.push(`id(${m.id}) 必须等于目录名(${dirName})`)
  }
  if (typeof m.name !== 'string' || !m.name) errors.push('name 必填')
  if (typeof m.version !== 'string' || !m.version) errors.push('version 必填')

  const servers = m.contributions?.mcpServers ?? []
  const serverIds = new Set<string>()
  for (const s of servers) {
    if (typeof s?.id !== 'string' || !s.id) {
      errors.push('mcpServers[].id 必填')
      continue
    }
    if (serverIds.has(s.id)) errors.push(`mcpServers id 重复：${s.id}`)
    serverIds.add(s.id)
    if (s.transport === 'stdio') {
      if (typeof s.command !== 'string' || !s.command) errors.push(`mcpServers ${s.id}: stdio 需要 command`)
    } else if (s.transport === 'http') {
      if (typeof s.url !== 'string' || !s.url) errors.push(`mcpServers ${s.id}: http 需要 url`)
    } else {
      errors.push(`mcpServers ${s.id}: transport 必须是 stdio 或 http`)
    }
  }

  const widgets = m.contributions?.widgets ?? []
  const widgetIds = new Set<string>()
  for (const w of widgets) {
    if (typeof w?.id !== 'string' || !w.id) {
      errors.push('widgets[].id 必填')
      continue
    }
    if (widgetIds.has(w.id)) errors.push(`widgets id 重复：${w.id}`)
    widgetIds.add(w.id)
    if (typeof w.entry !== 'string' || !w.entry) errors.push(`widgets ${w.id}: entry 必填`)
    if (w.placement !== undefined && w.placement !== 'sidebar' && w.placement !== 'float') {
      errors.push(`widgets ${w.id}: placement 只能是 sidebar 或 float`)
    }
  }

  for (const p of m.permissions ?? []) {
    if (!KNOWN_PERMISSIONS.has(p) && !p.startsWith('network:')) {
      errors.push(`未知权限：${p}`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, manifest: m }
}
