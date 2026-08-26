/**
 * 会话历史持久化：每个角色一份 JSON，落在数据根/chat_history/
 * （数据跟随安装目录，见 paths.getDataRoot）。
 *
 * 薄存储思路：主进程只做读写与原子落盘，消息结构的契约在渲染层
 * （chatStore 的 PersistedUserMessage/PersistedAssistantMessage）。
 * 多模态 user 消息的 content 是多模态片段数组（含 data:base64 图片），原样存取。
 *
 * 写入用「先写 .tmp 再 rename」保证崩溃不留半个文件；读取失败一律回退为空会话，
 * 不让损坏的历史文件把应用挡在门外。
 */

import fs from 'node:fs'
import path from 'node:path'
import type { ChatMessage } from '@shared/types'
import { getDataRoot } from './paths'
import { logBus } from './logBus'

function historyDir(): string {
  return path.join(getDataRoot(), 'chat_history')
}

/** 角色 id 来自文件夹名/卡片 id，可能含 Windows 文件名非法字符，做最小净化。 */
function sanitizeId(characterId: string): string {
  const cleaned = characterId
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
  return cleaned || '_default'
}

function historyPath(characterId: string): string {
  return path.join(historyDir(), `${sanitizeId(characterId)}.json`)
}

/** 读取某角色的会话消息数组。文件不存在 / 损坏 / 结构不对都返回空数组。 */
export function loadHistory(characterId: string): ChatMessage[] {
  const file = historyPath(characterId)
  let text: string
  try {
    text = fs.readFileSync(file, 'utf-8')
  } catch {
    return [] // 不存在 = 空会话，正常首启
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    logBus.warn('chat', `会话历史文件损坏，按空会话处理 (${file}): ${(err as Error).message}`)
    return []
  }
  // 兼容两种落盘形态：{messages:[...]} 或裸 [...]
  const messages = Array.isArray(parsed) ? parsed : (parsed as { messages?: unknown })?.messages
  return Array.isArray(messages) ? (messages as ChatMessage[]) : []
}

/** 覆盖写某角色的会话。messages 原样序列化（渲染层保证顺序与结构）。 */
export function saveHistory(characterId: string, messages: ChatMessage[]): void {
  const file = historyPath(characterId)
  fs.mkdirSync(historyDir(), { recursive: true })
  const payload = {
    version: 1,
    characterId,
    messages
  }
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8')
  fs.renameSync(tmp, file)
}

/** 清空某角色的会话（删文件；不存在视为成功）。 */
export function clearHistory(characterId: string): void {
  try {
    fs.rmSync(historyPath(characterId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }
}
