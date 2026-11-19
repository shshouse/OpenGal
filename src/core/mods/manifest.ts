export type ModCapability =
  | 'role-template'
  | 'appearance'
  | 'voice'
  | 'tts-engine'
  | 'asr-engine'
  | 'skill'
  | 'channel'

export interface DiscoveredModSummary {
  id: string
  folderName: string
  name: string
  displayName: string
  version: string
  capabilities: ModCapability[]
  summary: string
  tags: string[]
  color?: string
  language?: string
  performanceMode?: string
  hasVoice: boolean
}

type Obj = Record<string, unknown>

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.trim() : fallback
}

const KNOWN_CAPABILITIES = new Set<ModCapability>([
  'role-template',
  'appearance',
  'voice',
  'tts-engine',
  'asr-engine',
  'skill',
  'channel',
])

export function detectModManifest(
  raw: unknown,
  folderName: string,
  hintCategory?: 'Role' | 'TTS' | 'STT',
): DiscoveredModSummary | null {
  if (!isObject(raw)) return null

  const capabilities = new Set<ModCapability>()

  if (Array.isArray(raw.provides)) {
    for (const item of raw.provides) {
      if (typeof item === 'string' && KNOWN_CAPABILITIES.has(item as ModCapability)) {
        capabilities.add(item as ModCapability)
      }
    }
  }

  if (typeof raw.kind === 'string') {
    if (raw.kind === 'channel') capabilities.add('channel')
    else if (raw.kind === 'capability' || raw.kind === 'skill') capabilities.add('skill')
    else if (KNOWN_CAPABILITIES.has(raw.kind as ModCapability)) {
      capabilities.add(raw.kind as ModCapability)
    }
  }

  if (isObject(raw.persona) && isObject(raw.performance)) {
    capabilities.add('role-template')
  }
  if (isObject(raw.performance) && !isObject(raw.persona)) {
    capabilities.add('appearance')
  }
  if (isObject(raw.voice)) {
    capabilities.add('voice')
  }
  if (isObject(raw.contributions)) {
    const servers = raw.contributions.mcpServers
    if (Array.isArray(servers) && servers.length > 0) {
      capabilities.add(raw.kind === 'channel' ? 'channel' : 'skill')
    }
  }

  if (hintCategory === 'TTS') capabilities.add('tts-engine')
  if (hintCategory === 'STT') capabilities.add('asr-engine')

  if (capabilities.size === 0) return null

  const id = str(raw.id) || folderName
  const name = str(raw.name) || str(raw.displayName) || folderName
  const displayName = str(raw.displayName) || name
  const version = str(raw.version, '1.0.0')
  const describeObj = isObject(raw.describe) ? raw.describe : null
  const summary =
    str(describeObj?.summary) ||
    str(raw.description) ||
    (isObject(raw.persona) ? str(raw.persona.description).slice(0, 120) : '')
  const tags = Array.isArray(describeObj?.tags)
    ? describeObj.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : []
  const color = str(raw.color) || undefined
  const language = str(raw.language) || undefined
  const performanceMode = isObject(raw.performance) ? str(raw.performance.mode) || undefined : undefined

  return {
    id,
    folderName,
    name,
    displayName,
    version,
    capabilities: [...capabilities],
    summary,
    tags,
    ...(color ? { color } : {}),
    ...(language ? { language } : {}),
    ...(performanceMode ? { performanceMode } : {}),
    hasVoice: capabilities.has('voice'),
  }
}
