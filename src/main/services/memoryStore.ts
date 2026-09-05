import fs from 'node:fs'
import path from 'node:path'
import type {
  MemoryCandidateFact,
  MemoryCandidateStory,
  MemoryApplyPayload,
  MemoryConfig,
  MemoryFact,
  MemoryStory,
} from '@shared/types'

export type FactJudge = (
  existing: MemoryFact,
  candidate: MemoryCandidateFact,
) => Promise<'reinforces' | 'negates'>

let dataRoot = ''
let config: MemoryConfig = {
  factBudgetChars: 4000,
  storyBudgetChars: 3000,
  injectCharCap: 900,
  batchTurns: 8,
  idleMinutes: 5,
  fallbackHours: 12,
  windowBatchTurns: 10,
}

export function initMemoryStore(root: string, cfg?: Partial<MemoryConfig>): void {
  dataRoot = root
  if (cfg) config = { ...config, ...cfg }
}

export function getMemoryConfig(): MemoryConfig {
  return config
}

function charDir(characterId: string): string {
  const safe = characterId.replace(/[\\/:*?"<>|]/g, '_')
  return path.join(dataRoot, 'memory', safe)
}

function factsFile(characterId: string): string {
  return path.join(charDir(characterId), 'facts.json')
}

function storiesFile(characterId: string): string {
  return path.join(charDir(characterId), 'story.json')
}

function atomicWrite(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

export function loadFacts(characterId: string): MemoryFact[] {
  return readJson<MemoryFact[]>(factsFile(characterId), [])
}

export function loadStories(characterId: string): MemoryStory[] {
  return readJson<MemoryStory[]>(storiesFile(characterId), [])
}

export function clearMemory(characterId: string): void {
  try {
    fs.rmSync(charDir(characterId), { recursive: true, force: true })
  } catch { /* 目录不存在视为已清空 */ }
}

export function normalizeText(s: string): string {
  return s.replace(/[\s，。？！、,.?!;；:：""''「」（）()\-—~～]/g, '')
}

export function textSimilarity(a: string, b: string): number {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return 0
  if (na.includes(nb) || nb.includes(na)) return 1
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const ba = bigrams(na)
  const bb = bigrams(nb)
  if (ba.size === 0 || bb.size === 0) return 0
  let inter = 0
  for (const g of ba) if (bb.has(g)) inter++
  return (2 * inter) / (ba.size + bb.size)
}

const HIGH_SIMILARITY = 0.6
const MID_SIMILARITY = 0.35

export type Adjudication =
  | { action: 'insert' }
  | { action: 'refresh'; target: MemoryFact }
  | { action: 'judge'; target: MemoryFact }

export function adjudicateFact(
  candidate: MemoryCandidateFact,
  active: MemoryFact[],
): Adjudication {
  let best: MemoryFact | null = null
  let bestSim = 0
  for (const f of active) {
    if (f.entity !== candidate.entity) continue
    const sim = textSimilarity(candidate.text, f.text)
    if (sim > bestSim) {
      bestSim = sim
      best = f
    }
  }
  if (best && bestSim >= HIGH_SIMILARITY) return { action: 'refresh', target: best }
  if (best && bestSim >= MID_SIMILARITY && best.entity === candidate.entity) {
    return { action: 'judge', target: best }
  }
  return { action: 'insert' }
}

function nowIso(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function factScore(f: MemoryFact): number {
  return f.importance * f.confidence
}

export function storyScore(s: MemoryStory): number {
  const kindWeight = s.kind === 'milestone' ? 1.3 : s.kind === 'promise' ? 1.2 : s.kind === 'joke' ? 0.9 : 1
  return s.importance * kindWeight
}

function activeFacts(facts: MemoryFact[]): MemoryFact[] {
  return facts.filter((f) => f.status === 'active')
}

function activeStories(stories: MemoryStory[]): MemoryStory[] {
  return stories.filter((s) => s.status === 'active')
}

function charsOf(list: { text: string }[]): number {
  return list.reduce((sum, x) => sum + x.text.length, 0)
}

function fitBudget<T extends { text: string; status: 'active' | 'archived' }>(
  all: T[],
  incoming: T,
  budget: number,
  scoreOf: (x: T) => number,
): T | null {
  if (incoming.text.length > budget) return null
  const activeChars = (): number => charsOf(all.filter((x) => x.status === 'active'))
  if (activeChars() + incoming.text.length <= budget) return incoming
  const ordered = all.filter((x) => x.status === 'active').sort((a, b) => scoreOf(a) - scoreOf(b))
  for (const item of ordered) {
    item.status = 'archived'
    if (activeChars() + incoming.text.length <= budget) return incoming
  }
  return null
}

export interface ApplyResult {
  insertedFacts: number
  refreshedFacts: number
  judgedAway: number
  insertedStories: number
  budgetRejected: number
}

export async function applyCandidates(
  characterId: string,
  payload: MemoryApplyPayload,
  judge?: FactJudge,
): Promise<ApplyResult> {
  const facts = loadFacts(characterId)
  const stories = loadStories(characterId)
  const result: ApplyResult = {
    insertedFacts: 0,
    refreshedFacts: 0,
    judgedAway: 0,
    insertedStories: 0,
    budgetRejected: 0,
  }
  const ts = nowIso()

  for (const cand of payload.facts ?? []) {
    if (!cand.text?.trim()) continue
    const source = cand.confidence >= 1 ? 'user_statement' : 'llm_inferred'
    const adjudication = adjudicateFact(cand, activeFacts(facts))
    if (adjudication.action === 'refresh') {
      adjudication.target.last_confirmed_at = ts
      adjudication.target.evidence.reinforce += 1
      result.refreshedFacts++
      continue
    }
    if (adjudication.action === 'judge') {
      if (!judge) {
        result.judgedAway++
        continue
      }
      try {
        const verdict = await judge(adjudication.target, cand)
        if (verdict === 'reinforces') {
          adjudication.target.last_confirmed_at = ts
          adjudication.target.evidence.reinforce += 1
          result.refreshedFacts++
        } else {
          adjudication.target.status = 'archived'
          adjudication.target.evidence.negate += 1
          facts.push({
            id: newId('f'),
            text: cand.text,
            entity: cand.entity,
            importance: Math.min(10, Math.max(1, Math.round(cand.importance))),
            confidence: Math.min(1, Math.max(0.1, cand.confidence)),
            source,
            created_at: ts,
            last_confirmed_at: ts,
            status: 'active',
            evidence: { reinforce: 0, negate: 0 },
          })
          result.insertedFacts++
        }
      } catch {
        result.judgedAway++
      }
      continue
    }
    const entry: MemoryFact = {
      id: newId('f'),
      text: cand.text,
      entity: cand.entity,
      importance: Math.min(10, Math.max(1, Math.round(cand.importance))),
      confidence: Math.min(1, Math.max(0.1, cand.confidence)),
      source,
      created_at: ts,
      last_confirmed_at: ts,
      status: 'active',
      evidence: { reinforce: 0, negate: 0 },
    }
    const accepted = fitBudget(facts, entry, config.factBudgetChars, factScore)
    if (!accepted) {
      result.budgetRejected++
      continue
    }
    facts.push(entry)
    result.insertedFacts++
  }

  for (const cand of payload.stories ?? []) {
    if (!cand.text?.trim()) continue
    const entry: MemoryStory = {
      id: newId('s'),
      kind: cand.kind,
      text: cand.text,
      occurred_at: ts,
      due_at: cand.due_at ?? null,
      fulfilled: false,
      importance: Math.min(10, Math.max(1, Math.round(cand.importance))),
      status: 'active',
      created_at: ts,
    }
    const accepted = fitBudget(stories, entry, config.storyBudgetChars, storyScore)
    if (!accepted) {
      result.budgetRejected++
      continue
    }
    stories.push(entry)
    result.insertedStories++
  }

  atomicWrite(factsFile(characterId), facts)
  atomicWrite(storiesFile(characterId), stories)
  return result
}

export function manualAddFact(
  characterId: string,
  text: string,
  entity: MemoryFact['entity'] = 'user',
): MemoryFact {
  const facts = loadFacts(characterId)
  const ts = nowIso()
  const entry: MemoryFact = {
    id: newId('f'),
    text,
    entity,
    importance: 10,
    confidence: 1,
    source: 'manual',
    created_at: ts,
    last_confirmed_at: ts,
    status: 'active',
    evidence: { reinforce: 0, negate: 0 },
  }
  facts.push(entry)
  atomicWrite(factsFile(characterId), facts)
  return entry
}

export function buildMemoryBlock(
  facts: MemoryFact[],
  stories: MemoryStory[],
  charCap = config.injectCharCap,
): string | null {
  const actives = activeFacts(facts)
  const activeStoriesList = activeStories(stories)
  if (actives.length === 0 && activeStoriesList.length === 0) return null

  type Item = { text: string; score: number }
  const groups: Record<'user' | 'character' | 'relationship', Item[]> = {
    user: [],
    character: [],
    relationship: [],
  }
  for (const f of [...actives].sort((a, b) => factScore(b) - factScore(a))) {
    groups[f.entity].push({ text: f.text.slice(0, 60), score: factScore(f) })
  }

  const promises = activeStoriesList
    .filter((s) => s.kind === 'promise' && !s.fulfilled)
    .sort((a, b) => storyScore(b) - storyScore(a))
  const others = activeStoriesList
    .filter((s) => s.kind !== 'promise' || s.fulfilled)
    .sort((a, b) => storyScore(b) - storyScore(a))
    .slice(0, 6)

  const lines: string[] = []
  const relationshipItems: Item[] = []
  for (const p of promises) {
    const due = p.due_at ? `（约 ${p.due_at.slice(0, 10)}）` : ''
    relationshipItems.push({ text: `约定：${p.text}${due}（还没兑现）`, score: storyScore(p) + 5 })
  }
  for (const s of others) {
    relationshipItems.push({ text: s.text.slice(0, 60), score: storyScore(s) })
  }

  let total = 0
  const kept: string[] = []
  const emit: Array<[string, Item[]]> = [
    ['关于他', groups.user],
    ['关于你自己', groups.character],
    ['关于你们', relationshipItems],
  ]
  for (const [label, items] of emit) {
    items.sort((a, b) => b.score - a.score)
    const groupLines: string[] = []
    for (const item of items) {
      if (total + item.text.length > charCap) break
      total += item.text.length
      groupLines.push(item.text)
    }
    if (groupLines.length > 0) kept.push(`${label}：${groupLines.join('；')}`)
  }
  lines.push(...kept)
  if (lines.length === 0) return null
  lines.push('（以上是过往记忆，可能过时，以对方现在说的为准）')
  return `【你记得的事】\n${lines.join('\n')}`
}

export function getMemoryBlock(characterId: string): string | null {
  return buildMemoryBlock(loadFacts(characterId), loadStories(characterId))
}
