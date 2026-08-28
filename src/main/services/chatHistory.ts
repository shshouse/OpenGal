import fs from 'node:fs'
import path from 'node:path'
import type { ChatMessage } from '@shared/types'
import { getDataRoot } from './paths'
import { logBus } from './logBus'

function historyDir(): string {
  return path.join(getDataRoot(), 'chat_history')
}

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

export function loadHistory(characterId: string): ChatMessage[] {
  const file = historyPath(characterId)
  let text: string
  try {
    text = fs.readFileSync(file, 'utf-8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    logBus.warn('chat', `会话历史文件损坏，按空会话处理 (${file}): ${(err as Error).message}`)
    return []
  }
  const messages = Array.isArray(parsed) ? parsed : (parsed as { messages?: unknown })?.messages
  return Array.isArray(messages) ? (messages as ChatMessage[]) : []
}

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

export function clearHistory(characterId: string): void {
  try {
    fs.rmSync(historyPath(characterId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }
}
