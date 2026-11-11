import { create } from 'zustand'
import type { TTSOutputMessage } from '@shared/messages'
import { pipelineBus } from './pipelineBus'

export type SpokenMode = 'pending' | 'speech' | 'text'

interface SpokenLineState {
  mode: SpokenMode
  text: string
  segmentId: string | null
  roleId: string | null
}

const EMPTY: SpokenLineState = { mode: 'pending', text: '', segmentId: null, roleId: null }

export const useSpokenLineStore = create<SpokenLineState>(() => EMPTY)

/** 当前正在发声的台词。回合内第一段有音频就整轮按句跟随语音，否则回退到整段文字。 */
export function startSpokenLineBridge(): () => void {
  const onSegment = (msg: TTSOutputMessage): void => {
    useSpokenLineStore.setState((state) => ({
      mode: state.mode === 'pending' ? (msg.audioUrl ? 'speech' : 'text') : state.mode,
      text: msg.text,
      segmentId: msg.segmentId ?? null,
      roleId: msg.roleId ?? null,
    }))
  }
  const reset = (): void => useSpokenLineStore.setState(EMPTY)
  const offSegment = pipelineBus.on('tts:segmentStart', onSegment)
  const offUser = pipelineBus.on('user:input', reset)
  const offAbort = pipelineBus.on('pipeline:abort', reset)
  return () => {
    offSegment()
    offUser()
    offAbort()
  }
}
