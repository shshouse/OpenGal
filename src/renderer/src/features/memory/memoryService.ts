import { pipelineBus } from '@/features/pipeline/pipelineBus'
import type { LLMDialogMessage, UserInputMessage } from '@shared/messages'
import type { MemoryApplyPayload } from '@shared/types'
import { useCharacterStore } from '@/features/character/characterStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { setMemorySnapshot } from './snapshot'

async function refreshSnapshot(characterId: string): Promise<void> {
  try {
    const res = await window.opengal.memory.get(characterId)
    setMemorySnapshot(characterId, res.data?.block ?? null)
  } catch {
    setMemorySnapshot(characterId, null)
  }
}

interface CorpusEntry {
  characterId: string
  role: 'user' | 'assistant'
  text: string
  source?: string
  at: number
}

interface MemoryTuning {
  batchTurns: number
  idleMinutes: number
  fallbackHours: number
}

const DEFAULTS: MemoryTuning = { batchTurns: 8, idleMinutes: 5, fallbackHours: 12 }

let buffer: CorpusEntry[] = []
let extractBusy = false
let lastSuccessAt = 0
let lastCharacterId: string | null = null
let userTurns = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null
let watchdogTimer: ReturnType<typeof setInterval> | null = null
let offs: Array<() => void> = []

function log(level: 'info' | 'warn', msg: string): void {
  useLogsStore.getState().appendLocal(level, 'memory', msg)
}

function currentCharacterId(): string {
  return useCharacterStore.getState().getActive()?.id ?? 'default'
}

async function loadTuning(): Promise<MemoryTuning> {
  try {
    const res = await window.opengal.config.get()
    const m = res.data?.memory
    if (!m) return DEFAULTS
    return {
      batchTurns: m.batchTurns,
      idleMinutes: m.idleMinutes,
      fallbackHours: m.fallbackHours
    }
  } catch {
    return DEFAULTS
  }
}

function parseCandidates(raw: string): MemoryApplyPayload {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return { facts: [], stories: [] }
  const parsed = JSON.parse(m[0]) as Partial<MemoryApplyPayload>
  const facts = (parsed.facts ?? []).filter((f) => f.text?.trim() && f.reason)
  const stories = (parsed.stories ?? []).filter((s) => s.text?.trim() && s.reason)
  return { facts, stories }
}

function buildTranscript(entries: CorpusEntry[]): string {
  const now = Date.now()
  return entries
    .map((e) => {
      const ago = Math.max(0, Math.round((now - e.at) / 60000))
      const who = e.role === 'user' ? '用户' : '她'
      return `- ${who}（${ago} 分钟前）：${e.text}`
    })
    .join('\n')
}

const EXTRACTION_SYSTEM_PROMPT = `你是记忆提取器。从对话记录中提取值得长期记住的事实和故事。

每条候选必须同时过三关，任何一关不过就不要输出：
1 稳定性：一个月后仍然成立
2 可识别性：能帮助更了解用户或这段关系
3 有依据：对话里明确说了，不是猜测
reason 必填，想不出理由的条目直接不输出。

facts 是关于用户的属性事实（生日、身份、稳定偏好、习惯、关系性质），entity 取值：user（关于用户）/ character（关于角色自己）/ relationship（关于双方关系）。
importance 1-10：姓名、生日、明确要求记住=10；强偏好=7；一般习惯=4。
confidence：用户明确陈述=1.0；你推断的=0.5。
valid_until：如果事实有时间敏感性（如"最近在学日语"、"明天要出差"），给出 ISO 日期字符串（估计有效期）；长期事实给 null。
frozen：如果用户明确要求"记住"或"别忘了"，设为 true。

stories 是故事：kind 取值 event（共同经历）/ promise（约定）/ milestone（关系里程碑）/ joke（共同梗）。promise 尽量给 due_at（ISO 日期字符串，推不出为 null）。
不记：临时情绪、一次性安排（约定除外）、寒暄、与用户无关的内容。

只输出一个 JSON 对象，不要任何其他文字：
{"facts":[{"text":"不超过40字","entity":"user","importance":8,"confidence":1.0,"reason":"简短理由","valid_until":null,"frozen":false}],"stories":[{"kind":"promise","text":"不超过40字","importance":7,"reason":"简短理由","due_at":null}]}
没有可提取的就输出 {"facts":[],"stories":[]}`

async function runExtract(force = false): Promise<void> {
  if (extractBusy) return
  const groups = new Map<string, CorpusEntry[]>()
  for (const e of buffer) {
    if (e.role === 'user' && (e.source === 'plugin' || e.source === 'live')) continue
    const list = groups.get(e.characterId) ?? []
    list.push(e)
    groups.set(e.characterId, list)
  }
  if (groups.size === 0) return
  if (!force) {
    const current = currentCharacterId()
    const currentGroup = groups.get(current) ?? []
    const userTurns = currentGroup.filter((e) => e.role === 'user').length
    if (userTurns === 0 && groups.size === 1) return
  }

  extractBusy = true
  try {
    for (const [characterId, entries] of groups) {
      if (!entries.some((e) => e.role === 'user')) continue
      const res = await window.opengal.llm.chat({
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: buildTranscript(entries) }
        ]
      })
      if (!res.success || !res.data?.content) {
        log('warn', `提取失败（${characterId}）：${res.error ?? '空回复'}，语料保留`)
        continue
      }
      let candidates: MemoryApplyPayload
      try {
        candidates = parseCandidates(res.data.content)
      } catch (err) {
        log('warn', `提取输出无法解析（${characterId}），语料保留：${(err as Error).message}`)
        continue
      }
      const applied = await window.opengal.memory.apply(characterId, candidates)
      if (!applied.success || !applied.data) {
        log('warn', `记忆入库失败（${characterId}）：${applied.error ?? '未知错误'}，语料保留`)
        continue
      }
      const r = applied.data
      dropEntries(characterId)
      lastSuccessAt = Date.now()
      await refreshSnapshot(characterId)
      log(
        'info',
        `回想完成（${characterId}）：新记 ${r.insertedFacts} 条事实 / ${r.insertedStories} 条故事，印证 ${r.refreshedFacts} 条` +
          (r.judgedAway > 0 ? `，矛盾待判放弃 ${r.judgedAway} 条` : '') +
          (r.budgetRejected > 0 ? `，预算拒收 ${r.budgetRejected} 条` : '')
      )
    }
  } finally {
    extractBusy = false
  }
}

function dropEntries(characterId: string): void {
  buffer = buffer.filter((e) => e.characterId !== characterId)
}

let decaySweepTimer: ReturnType<typeof setInterval> | null = null
const DECAY_SWEEP_INTERVAL_MS = 60 * 60 * 1000

async function runDecaySweep(): Promise<void> {
  const characterId = currentCharacterId()
  try {
    const res = await window.opengal.memory.decaySweep(characterId)
    if (res.success && res.data && res.data.archived > 0) {
      log('info', `遗忘曲线清理（${characterId}）：归档 ${res.data.archived} 条低保留记忆`)
      await refreshSnapshot(characterId)
    }
  } catch {
    /* ignore */
  }
}

function startDecaySweep(): void {
  if (decaySweepTimer) clearInterval(decaySweepTimer)
  decaySweepTimer = setInterval(() => {
    void runDecaySweep()
  }, DECAY_SWEEP_INTERVAL_MS)
}

function stopDecaySweep(): void {
  if (decaySweepTimer) {
    clearInterval(decaySweepTimer)
    decaySweepTimer = null
  }
}

function scheduleIdle(minutes: number): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    void runExtract()
  }, minutes * 60_000)
}

export function startMemoryService(): () => void {
  if (offs.length > 0) return () => {}
  startDecaySweep()
  const offInput = pipelineBus.on('user:input', (input: UserInputMessage) => {
    const characterId = currentCharacterId()
    if (lastCharacterId && characterId !== lastCharacterId) {
      void runExtract(true)
      void refreshSnapshot(characterId)
    }
    lastCharacterId = characterId
    buffer.push({
      characterId,
      role: 'user',
      text: input.text.slice(0, 500),
      source: input.source,
      at: Date.now()
    })
    userTurns++
    void loadTuning().then((tuning) => {
      if (userTurns >= tuning.batchTurns) {
        userTurns = 0
        void runExtract()
      } else {
        scheduleIdle(tuning.idleMinutes)
      }
    })
  })
  const offDialog = pipelineBus.on('llm:dialog', (msg: LLMDialogMessage) => {
    buffer.push({
      characterId: currentCharacterId(),
      role: 'assistant',
      text: msg.text.slice(0, 300),
      at: Date.now()
    })
    if (buffer.length > 400) buffer = buffer.slice(-400)
  })
  watchdogTimer = setInterval(
    () => {
      void loadTuning().then((tuning) => {
        const hasPending = buffer.some((e) => e.role === 'user')
        const overdue = Date.now() - lastSuccessAt > tuning.fallbackHours * 3_600_000
        if (hasPending && (overdue || lastSuccessAt === 0)) {
          if (lastSuccessAt === 0 && buffer.length > 0) return
          void runExtract(true)
        }
      })
    },
    10 * 60_000
  )
  void refreshSnapshot(currentCharacterId())
  offs = [offInput, offDialog]
  return () => {
    for (const off of offs) off()
    offs = []
    if (idleTimer) clearTimeout(idleTimer)
    if (watchdogTimer) clearInterval(watchdogTimer)
    stopDecaySweep()
  }
}
