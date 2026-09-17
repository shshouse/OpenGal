import type { BootResult, BootStep } from '@shared/types'
import { readConfig } from './configStore'
import { memoryDbReady } from './memoryDb'
import { startTTSServer } from './ttsServer'
import { warmupTTS } from './ttsClient'
import { logBus } from './logBus'

// 启动自检：记忆库就绪检查 + TTS 服务拉起与预热，逐步通过 IPC 推给渲染进程
type MainStepId = 'memory' | 'tts'

const MAIN_STEPS: Array<BootStep & { id: MainStepId }> = [
  { id: 'memory', label: '记忆数据库', status: 'pending' },
  { id: 'tts', label: 'TTS 语音服务', status: 'pending' }
]

const runners: Record<MainStepId, () => Promise<{ status: 'ok' | 'skipped'; detail?: string }>> = {
  memory: async () => {
    await memoryDbReady()
    return { status: 'ok' }
  },
  tts: async () => {
    if (!readConfig().tts.enabled) return { status: 'skipped', detail: '未启用' }
    const status = await startTTSServer()
    if (!status.running) throw new Error('TTS server not running')
    await warmupTTS()
    return { status: 'ok', detail: status.message === '复用已有服务' ? '复用运行中的服务' : undefined }
  }
}

let snapshot: BootResult | null = null
let running: Promise<BootResult> | null = null

export function runBootSequence(send: (step: BootStep) => void): Promise<BootResult> {
  if (snapshot) {
    for (const s of snapshot.steps) send(s)
    return Promise.resolve(snapshot)
  }
  if (running) return running
  running = (async () => {
    for (const step of MAIN_STEPS) {
      send({ ...step, status: 'running' })
      try {
        const r = await runners[step.id]()
        const done: BootStep = { ...step, status: r.status, detail: r.detail }
        step.status = done.status
        step.detail = done.detail
        send(done)
      } catch (err) {
        logBus.error('boot', `${step.label} 启动失败: ${(err as Error).message}`)
        step.status = 'failed'
        step.detail = '启动失败，请查看日志'
        send({ ...step })
      }
    }
    snapshot = { steps: MAIN_STEPS.map((s) => ({ ...s })), llmConfigured: !!readConfig().llm.apiKey }
    return snapshot
  })()
  return running
}
