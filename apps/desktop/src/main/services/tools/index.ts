/**
 * 工具注册表：定义（OpenAI function schema）+ 执行器（本地副作用）。
 *
 * 工具必须是无状态或可重入的；执行器签名 (args) => Promise<string>，
 * 返回字符串会作为 role: 'tool' 消息回传给 LLM。
 */

import { logBus } from '../logBus'
import type { ToolDefinition } from '@shared/types'

type ToolHandler = (args: Record<string, unknown>) => Promise<string>

interface ToolEntry {
  def: ToolDefinition
  handle: ToolHandler
}

const tools = new Map<string, ToolEntry>()

export function registerTool(def: ToolDefinition, handler: ToolHandler): void {
  tools.set(def.function.name, { def, handle: handler })
}

export function getToolDefinitions(): ToolDefinition[] {
  return Array.from(tools.values()).map((e) => e.def)
}

export async function executeTool(
  name: string,
  argsJson: string
): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  const entry = tools.get(name)
  if (!entry) return { ok: false, error: `Unknown tool: ${name}` }
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>
  } catch (err) {
    return { ok: false, error: `Invalid tool args JSON: ${(err as Error).message}` }
  }
  try {
    const result = await entry.handle(args)
    logBus.info('tools', `执行 ${name} 成功`, result.slice(0, 200))
    return { ok: true, result }
  } catch (err) {
    const msg = (err as Error).message
    logBus.error('tools', `执行 ${name} 失败: ${msg}`)
    return { ok: false, error: msg }
  }
}

logBus.info('tools', `已注册 ${tools.size} 个工具`)
