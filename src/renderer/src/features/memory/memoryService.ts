import { pipelineBus } from '@/features/pipeline/pipelineBus'
import type { LLMDialogMessage, UserInputMessage } from '@shared/messages'
import type { MemoryApplyPayload } from '@shared/types'
import { useCharacterStore } from '@/features/character/characterStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { setMemorySnapshot } from './snapshot'
import { CorpusBuffer, type CorpusEntry } from './corpusBuffer'

async function refreshSnapshot(characterId: string): Promise<void> {
  try {
    const res = await window.opengal.memory.get(characterId)
    setMemorySnapshot(characterId, res.data?.block ?? null)
  } catch {
    setMemorySnapshot(characterId, null)
  }
}

interface MemoryTuning {
  batchTurns: number
  idleMinutes: number
  fallbackHours: number
}

const DEFAULTS: MemoryTuning = { batchTurns: 8, idleMinutes: 5, fallbackHours: 12 }

const buffer = new CorpusBuffer(1000, (dropped) => {
  log('warn', `语料缓冲超过上限，已丢弃最旧 ${dropped} 条未提取对话`)
})
let extractBusySince = 0
const EXTRACT_LATCH_TTL_MS = 180_000
let lastSuccessAt = 0
let lastCharacterId: string | null = null
let userTurns = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null
let watchdogTimer: ReturnType<typeof setInterval> | null = null
let pruneTimer: ReturnType<typeof setInterval> | null = null
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

facts 是关于用户的属性事实（生日、身份、稳定偏好、习惯、关系性质）。
entity 取值：user（关于用户）/ character（关于角色自己）/ relationship（关于双方关系）。
subject：这条事实的主语。用户写"用户"，角色写"角色"，具体事物写名字（如"用户的猫"）。
attribute：槽位名，用稳定、可复用的短词。同一件事必须沿用同一个词。只能表达一个值的槽位请用这些标准词：居住城市、生日、名字、昵称、年龄、职业、公司、学校、专业、身高、体重、手机号、邮箱、住址；其余用自然短词，如"喜欢的饮料""猫的名字"。
object：这条事实的取值或宾语，例如"上海""3月15日""咖啡"。同一槽位下不同 object 代表不同的事（喜欢咖啡和喜欢茶是两条）。
polarity：肯定陈述为 true；否定陈述（"不喜欢""不再""不养了"）为 false，此时 object 仍写被否定的那个对象。
attributed_to：谁说的。用户亲口说的=user；角色自己说的=character；你从语气推断的=inferred。
importance 1-10：姓名、生日、明确要求记住=10；强偏好=7；一般习惯=4。
confidence：明确陈述=1.0；推断=0.5。
valid_until：如果事实有时间敏感性（如"最近在学日语"、"明天要出差"），给出 ISO 日期字符串（估计有效期）；长期事实给 null。
frozen：如果用户明确要求"记住"或"别忘了"，设为 true。

只记录现在成立的值。对方改口时只输出新值，不要输出"以前是X"。否定也要单独输出一条（polarity=false），不要靠省略表达。
stories 是故事：kind 取值 event（共同经历）/ promise（约定）/ milestone（关系里程碑）/ joke（共同梗）。promise 尽量给 due_at（ISO 日期字符串，推不出为 null）。
不记：临时情绪、一次性安排（约定除外）、寒暄、与用户无关的内容。

只输出一个 JSON 对象，不要任何其他文字：
{"facts":[{"text":"不超过40字","entity":"user","subject":"用户","attribute":"生日","object":"3月15日","polarity":true,"attributed_to":"user","importance":10,"confidence":1.0,"reason":"简短理由","valid_until":null,"frozen":false}],"stories":[{"kind":"promise","text":"不超过40字","importance":7,"reason":"简短理由","due_at":null}]}
没有可提取的就输出 {"facts":[],"stories":[]}`

async function runExtract(force = false): Promise<void> {
  // 看门狗：闩锁带 TTL，防止上游 Promise 永不 settle 导致永久锁死
  if (extractBusySince && Date.now() - extractBusySince < EXTRACT_LATCH_TTL_MS) return
  if (extractBusySince) {
    log('warn', '记忆提取闩锁超时，强制复位')
  }
  const snapshot = buffer.snapshot()
  const groups = new Map<string, CorpusEntry[]>()
  for (const e of snapshot.entries) {
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

  // 闩锁在早退之后上锁，避免空跑路径泄漏闩锁
  extractBusySince = Date.now()
  try {
    for (const [characterId, entries] of groups) {
      if (!entries.some((e) => e.role === 'user')) continue
      const res = await window.opengal.llm.chat({
        slot: 'sub',
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
      candidates.evidence = {
        fromTs: Math.min(...entries.map((e) => e.at)),
        toTs: Math.max(...entries.map((e) => e.at)),
      }
      const applied = await window.opengal.memory.apply(characterId, candidates)
      if (!applied.success || !applied.data) {
        log('warn', `记忆入库失败（${characterId}）：${applied.error ?? '未知错误'}，语料保留`)
        continue
      }
      const r = applied.data
      buffer.dropExtracted(characterId, snapshot.maxSeq)
      const newest = Math.max(...entries.map((e) => e.at))
      await window.opengal.memory.advanceCursor(characterId, newest)
      lastSuccessAt = Date.now()
      await refreshSnapshot(characterId)
      log(
        'info',
        `回想完成（${characterId}）：新记 ${r.insertedFacts} 条事实 / ${r.insertedStories} 条故事，确认 ${r.refreshedFacts} 条`
      )
    }
  } finally {
    extractBusySince = 0
  }
}

function scheduleIdle(minutes: number): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    void runExtract()
  }, minutes * 60_000)
}

const SEED_BATCH = 60
const SEED_ROUNDS = 5

let seedBusy = false

// 原文已经在库里，游标也在库里：启动时把没提取过的部分续上，崩溃也不丢
async function seedFromArchive(characterId: string): Promise<void> {
  if (seedBusy) return
  seedBusy = true
  try {
    await seedLoop(characterId)
  } finally {
    seedBusy = false
  }
}

async function seedLoop(characterId: string): Promise<void> {
  for (let round = 0; round < SEED_ROUNDS; round++) {
    let cursor = 0
    let entries: Array<{ role: 'user' | 'assistant', text: string, at: number }> = []
    try {
      const res = await window.opengal.memory.pending(characterId, SEED_BATCH)
      if (!res.success || !res.data) return
      cursor = res.data.cursor
      entries = res.data.entries.filter((e) => e.at > cursor)
    } catch (err) {
      log('warn', `补记失败：${(err as Error).message}`)
      return
    }
    if (entries.length === 0) return
    for (const entry of entries) {
      buffer.push({ characterId, role: entry.role, text: entry.text, at: entry.at, source: 'archive' })
    }
    log('info', `补记：从历史带回 ${entries.length} 条未提取的对话`)
    await runExtract(true)
    try {
      const after = await window.opengal.memory.pending(characterId, 1)
      const nextCursor = after.data?.cursor ?? cursor
      if (nextCursor <= cursor) return
    } catch {
      return
    }
  }
  try {
    const tail = await window.opengal.memory.pending(characterId, 1)
    if (tail.success && tail.data && tail.data.entries.length > 0) {
      log('info', '还有未补记的对话，下次启动继续')
    }
  } catch {
    /* ignore */
  }
}

export async function rebuildMemoryIndex(characterId: string): Promise<void> {
  const res = await window.opengal.memory.rebuild(characterId)
  if (!res.success || !res.data) {
    if (!res.error?.includes('已取消')) log('warn', `重建失败：${res.error ?? '未知错误'}`)
    return
  }
  log('info', `已清空抽取层（事实 ${res.data.facts} / 经历 ${res.data.stories}），开始按原文重放`)
  setMemorySnapshot(characterId, null)
  await seedFromArchive(characterId)
}

export function startMemoryService(): () => void {
  if (offs.length > 0) return () => {}
  const offInput = pipelineBus.on('user:input', (input: UserInputMessage) => {
    const characterId = currentCharacterId()
    if (lastCharacterId && characterId !== lastCharacterId) {
      void runExtract(true)
      void refreshSnapshot(characterId)
      void seedFromArchive(characterId)
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
  })
  watchdogTimer = setInterval(
    () => {
      void loadTuning().then((tuning) => {
        const hasPending = buffer.hasPendingUser()
        const overdue = Date.now() - lastSuccessAt > tuning.fallbackHours * 3_600_000
        if (hasPending && (overdue || lastSuccessAt === 0)) {
          if (lastSuccessAt === 0 && buffer.size() > 0) return
          void runExtract(true)
        }
      })
    },
    10 * 60_000
  )
  pruneTimer = setInterval(() => {
    const characterId = currentCharacterId()
    void window.opengal.memory
      .prune(characterId)
      .then((res) => {
        if (res.success && res.data && res.data.archived > 0) {
          log('info', `记忆归档（${characterId}）：${res.data.archived} 条超出上限，已归档`)
          void refreshSnapshot(characterId)
        }
      })
      .catch(() => {})
  }, 60 * 60_000)
  void refreshSnapshot(currentCharacterId())
  void seedFromArchive(currentCharacterId())
  offs = [offInput, offDialog]
  return () => {
    for (const off of offs) off()
    offs = []
    if (idleTimer) clearTimeout(idleTimer)
    if (watchdogTimer) clearInterval(watchdogTimer)
    if (pruneTimer) clearInterval(pruneTimer)
  }
}
