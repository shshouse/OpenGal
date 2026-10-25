import offline from './sherpaEngine'
import streaming from './streamingEngine'
import { readConfig } from '../configStore'
import type { ASREngine } from './types'

let active: ASREngine = offline

const engine: ASREngine = {
  start: async () => {
    offline.stop()
    streaming.stop()
    active = readConfig().asr.mode === 'streaming' ? streaming : offline
    await active.start()
  },
  stop: () => {
    offline.stop()
    streaming.stop()
    active = offline
  },
  feed: (pcm16) => active.feed(pcm16),
  isRunning: () => offline.isRunning() || streaming.isRunning(),
  setResultCallback: (cb) => {
    offline.setResultCallback(cb)
    streaming.setResultCallback(cb)
  },
  setSpeechStartCallback: (cb) => {
    offline.setSpeechStartCallback(cb)
    streaming.setSpeechStartCallback(cb)
  }
}

export function getEngine(): ASREngine {
  return engine
}
