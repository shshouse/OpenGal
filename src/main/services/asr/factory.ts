import * as vosk from './voskEngine'
import sherpa from './sherpaEngine'
import type { ASREngine } from './types'
import { readConfig } from '../configStore'

const voskEngine: ASREngine = {
  start: () => vosk.startASR(),
  stop: () => vosk.stopASR(),
  feed: (pcm16) => vosk.feedAudio(pcm16),
  isRunning: () => vosk.isASRRunning(),
  setResultCallback: (cb) => vosk.setResultCallback(cb)
}

export function getEngine(): ASREngine {
  return readConfig().asr.engine === 'sherpa' ? sherpa : voskEngine
}
