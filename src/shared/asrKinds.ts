export interface SherpaModelKindInfo {
  prefix: string
  kind: string
  supportsHotwords: boolean
}

export const SHERPA_MODEL_KINDS: SherpaModelKindInfo[] = [
  { prefix: 'sherpa-onnx-qwen3-asr-', kind: 'qwen3', supportsHotwords: true },
  { prefix: 'sherpa-onnx-sense-voice-', kind: 'sensevoice', supportsHotwords: false },
  { prefix: 'sherpa-onnx-funasr-nano-', kind: 'funasr_nano', supportsHotwords: false }
]

export function detectSherpaKind(modelPath: string): SherpaModelKindInfo | null {
  const name = modelPath.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? ''
  return SHERPA_MODEL_KINDS.find((k) => name.startsWith(k.prefix)) ?? null
}

export function normalizeAsrEngine(_engine: string | undefined): 'sherpa' {
  return 'sherpa'
}
