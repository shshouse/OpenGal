import { useChatStore } from '@/features/chat/chatStore'
import { useToolCallsStore } from '@/features/tools/toolCallsStore'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import { useActivityStore, type ActivityEntry } from './activityStore'

let sequence = 0
function id(prefix: string): string {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`
}

function add(characterId: string | null, entry: Omit<ActivityEntry, 'characterId'>): void {
  if (!characterId) return
  useActivityStore.getState().add({ ...entry, characterId })
}

export function startActivityBridge(): () => void {
  const offInput = pipelineBus.on('user:input', (input) => {
    const synthetic = input.source === 'system'
    add(useChatStore.getState().sessionId, {
      id: id(synthetic ? 'system' : 'user'),
      kind: synthetic ? 'system' : 'user',
      title: synthetic ? '触发主动回应' : '收到你的消息',
      detail: synthetic ? undefined : input.text,
      at: Date.now(),
    })
  })
  const offDialog = pipelineBus.on('llm:dialog', (msg) => {
    add(msg.characterId ?? useChatStore.getState().sessionId, {
      id: id('speech'),
      kind: 'speech',
      title: '开口说话',
      detail: msg.text,
      at: Date.now(),
    })
  })
  const offDone = pipelineBus.on('llm:done', (msg) => {
    if (msg.ok) return
    add(useChatStore.getState().sessionId, {
      id: id('error'),
      kind: 'error',
      title: '回应失败',
      detail: msg.error,
      ok: false,
      at: Date.now(),
    })
  })
  const offTools = useToolCallsStore.subscribe((state, previous) => {
    const record = state.records[state.records.length - 1]
    if (!record || state.records.length <= previous.records.length) return
    add(useChatStore.getState().sessionId, {
      id: id('tool'),
      kind: 'tool',
      title: `调用 ${record.name}`,
      detail: record.result.slice(0, 240),
      ok: record.ok,
      at: Date.now(),
    })
  })
  return () => {
    offInput()
    offDialog()
    offDone()
    offTools()
  }
}
