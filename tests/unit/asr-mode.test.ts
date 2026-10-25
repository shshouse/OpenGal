import { describe, expect, it } from 'vitest'
import { detectSherpaKind, normalizeAsrMode } from '../../src/shared/asrKinds'
import { needsASRRestart } from '../../src/shared/asrSettings'
import type { ASRConfig } from '../../src/shared/types'

const base = {
  enabled: true,
  engine: 'sherpa',
  mode: 'offline',
  modelPath: '',
  language: 'zh',
  sampleRate: 16000,
  autoSend: true,
  deviceId: '',
  hotwords: [],
  vadSilenceMs: 600,
  directorEnabled: false,
  directorScreenContext: false,
  directorCooldownSec: 20,
  directorInitiativeEnabled: false,
  directorInitiativePerHour: 3,
  directorIdleMinutes: 10,
} as ASRConfig

describe('ASR mode', () => {
  it('默认离线，只有显式 streaming 才切换', () => {
    expect(normalizeAsrMode(undefined)).toBe('offline')
    expect(normalizeAsrMode('offline')).toBe('offline')
    expect(normalizeAsrMode('streaming')).toBe('streaming')
    expect(normalizeAsrMode('unknown')).toBe('offline')
  })

  it('切换模式会触发识别器重载', () => {
    expect(needsASRRestart(base, { ...base, mode: 'streaming' })).toBe(true)
    expect(needsASRRestart(base, { ...base })).toBe(false)
  })

  it('流式 Zipformer 模型被识别为不支持热词', () => {
    expect(detectSherpaKind('sherpa-onnx-streaming-zipformer-zh-xlarge-int8-2025-06-30')?.kind).toBe('streaming_zipformer')
    expect(detectSherpaKind('sherpa-onnx-streaming-zipformer-zh-xlarge-int8-2025-06-30')?.supportsHotwords).toBe(false)
  })
})
