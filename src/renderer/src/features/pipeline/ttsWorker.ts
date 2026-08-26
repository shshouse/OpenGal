/**
 * TTSWorker：消费 `llm:dialog`，按需调用 TTS 合成音频，输出 `tts:output`。
 *
 * 对齐 RachelForster 的 `TTSWorker` (`core/runtime/workers.py`) + `tts_message_handler.py`：
 * - 不同 `name`（COT/BGM/CG/选项 等系统关键字 vs 角色名）走不同 handler 链路
 * - 当前先实现「角色对话」分支（DefaultCharacterTtsHandler 等价路径），其它系统关键字
 *   留到 M3 AVG 演出层再扩展
 *
 * 串行：保持一条 in-flight 任务，避免 GPT-SoVITS 端并发产生顺序错乱。
 */

import type { LLMDialogMessage, TTSOutputMessage } from '@shared/messages'
import { useLogsStore } from '@/features/logs/logsStore'
import { pipelineBus } from './pipelineBus'

let bound = false
let unsubscribers: Array<() => void> = []
let queue: Array<LLMDialogMessage> = []
let processing = false
/**
 * 一次会话内只针对同一个 TTS 错误信息提醒一次，避免每条对话都打印 console
 * 把控制台塞满。下次成功合成时会自动重置（见 synthesize）。
 */
let hasWarnedThisSession = false
let lastWarnedMessage = ''

function reportTTSError(message: string): void {
  if (hasWarnedThisSession && message === lastWarnedMessage) return
  hasWarnedThisSession = true
  lastWarnedMessage = message
  useLogsStore.getState().appendLocal('warn', 'tts-worker', `语音合成失败: ${message}`)
}

export function startTTSWorker(): () => void {
  if (bound) return stopTTSWorker
  bound = true

  const offDialog = pipelineBus.on('llm:dialog', (msg) => {
    queue.push(msg)
    void drainQueue()
  })

  const offAbort = pipelineBus.on('pipeline:abort', () => {
    queue = []
    processing = false
  })

  unsubscribers = [offDialog, offAbort]
  return stopTTSWorker
}

export function stopTTSWorker(): void {
  for (const off of unsubscribers) off()
  unsubscribers = []
  bound = false
  queue = []
  processing = false
}

async function drainQueue(): Promise<void> {
  if (processing) return
  processing = true
  try {
    while (queue.length > 0) {
      const msg = queue.shift()!
      const out = await synthesize(msg)
      pipelineBus.emit('tts:output', out)
      // 无音频时的节奏补偿：真实语音会占掉台词长度对应的时长，动作在此期间
      // 完整播放。TTS 失败/关闭时若不补偿，多段台词会在几百毫秒内连发，
      // 每段的动作刚起手就被下一段 FORCE 打断（表现为「动作只闪一下就没了」）
      if (!out.audioUrl && out.text) {
        await sleepSilentSegment(out.text)
      }
    }
  } finally {
    processing = false
  }
}

/**
 * 静音片段的停留时长：按中文朗读约 4 字/秒估算（250ms/字），下限保证一个
 * 反应动作（约 2s）能播完，上限防止超长台词把队列卡住太久。
 */
function sleepSilentSegment(text: string): Promise<void> {
  const estimated = Math.min(12000, Math.max(1800, text.length * 250))
  return new Promise((resolve) => setTimeout(resolve, estimated))
}

/**
 * 把一条对话片段转成 `TTSOutputMessage`。
 *
 * 当前实现：仅支持「角色对话」分支，调主进程 `tts:speak` 拿到 base64 音频。
 * 失败或 TTS 关闭时返回无音频的 `TTSOutputMessage`，UI 仍能展示文本气泡。
 */
async function synthesize(msg: LLMDialogMessage): Promise<TTSOutputMessage> {
  const speech = (msg.translate || msg.text || '').trim()
  if (!speech) {
    return {
      audioUrl: '',
      name: msg.name,
      text: msg.text || '',
      assetId: msg.assetId ?? '-1',
      emotion: msg.emotion,
      motion: msg.motion,
      effect: msg.effect,
      isSystem: false,
      isFinalSegment: true,
    }
  }

  let audioUrl = ''
  try {
    const result = await window.opengal.tts.speak({ text: speech })
    if (result.success && result.data) {
      audioUrl = `data:${result.data.mimeType};base64,${result.data.audioBase64}`
      // TTS 恢复后，重置一次性告警标志，让下次故障时再次提醒
      hasWarnedThisSession = false
    } else if (result.error && !/disabled/i.test(result.error)) {
      reportTTSError(result.error)
    }
  } catch (err) {
    reportTTSError((err as Error).message)
  }

  return {
    audioUrl,
    name: msg.name,
    text: msg.text,
    assetId: msg.assetId ?? '-1',
    emotion: msg.emotion,
    motion: msg.motion,
    effect: msg.effect,
    isSystem: false,
    isFinalSegment: true,
  }
}
