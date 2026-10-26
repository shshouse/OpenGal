import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as memoryDb from '../../src/main/services/memoryDb'
import * as memoryStore from '../../src/main/services/memoryStore'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-eval-'))

const { recallVerbatim } = memoryStore as unknown as {
  recallVerbatim?: (
    characterId: string,
    query: string,
    charCap?: number,
    range?: { fromTs: number; toTs: number },
  ) => Promise<string | null>
}

const t = (month: number, day: number) => Date.UTC(2024, month - 1, day, 10, 0)

interface Line {
  role: 'user' | 'assistant'
  text: string
  ts: number
}

const CONVERSATIONS: Record<string, Line[]> = {
  'c-eval': [
    { role: 'user', text: '今天下班路上看到一只橘猫', ts: t(3, 12) },
    { role: 'assistant', text: '橘猫都很亲人吧', ts: t(3, 12) + 60_000 },
    { role: 'user', text: '我想养一只猫，名字就叫年糕', ts: t(3, 12) + 120_000 },
    { role: 'user', text: '下个月我要去南京出差一周', ts: t(7, 3) },
    { role: 'assistant', text: '南京这个时候很热，记得带短袖', ts: t(7, 3) + 60_000 },
    { role: 'user', text: '我其实一直不太喜欢下雨天', ts: t(11, 20) },
  ],
  'c-other': [
    { role: 'user', text: '我下周也要去南京，不过是出差', ts: t(3, 12) },
  ],
}

interface EvalCase {
  id: string
  kind: 'verbatim' | 'time' | 'miss' | 'cross' | 'semantic'
  character: string
  query: string
  range?: { fromTs: number; toTs: number }
  expect?: string
  forbid?: string
}

const CASES: EvalCase[] = [
  { id: 'v1', kind: 'verbatim', character: 'c-eval', query: '年糕', expect: '年糕' },
  { id: 'v2', kind: 'verbatim', character: 'c-eval', query: '橘猫', expect: '橘猫' },
  { id: 'v3', kind: 'verbatim', character: 'c-eval', query: '南京 出差', expect: '南京' },
  {
    id: 't1',
    kind: 'time',
    character: 'c-eval',
    query: '南京',
    range: { fromTs: t(7, 1), toTs: t(7, 31) },
    expect: '出差',
  },
  {
    id: 't2',
    kind: 'miss',
    character: 'c-eval',
    query: '南京',
    range: { fromTs: t(1, 1), toTs: t(2, 1) },
  },
  { id: 'm1', kind: 'miss', character: 'c-eval', query: '量子力学' },
  { id: 'x1', kind: 'cross', character: 'c-other', query: '年糕', forbid: '年糕' },
  { id: 's1', kind: 'semantic', character: 'c-eval', query: '宠物', expect: '猫' },
]

async function runCase(c: EvalCase): Promise<boolean> {
  const text = await recallVerbatim!(c.character, c.query, 1500, c.range)
  if (c.kind === 'miss' || c.kind === 'cross') {
    if (!text) return true
    return c.forbid ? !text.includes(c.forbid) : false
  }
  if (!text) return false
  return c.expect ? text.includes(c.expect) : Boolean(text)
}

describe('记忆检索评测', () => {
  beforeAll(async () => {
    await memoryDb.initMemoryDb(root)
    await memoryDb.memoryDbReady()
    for (const [characterId, lines] of Object.entries(CONVERSATIONS)) {
      for (const line of lines) {
        memoryDb.appendMessage({
          character_id: characterId,
          role: line.role,
          content: JSON.stringify({ role: line.role, content: line.text }),
          ts: line.ts,
          archived: 1,
        })
      }
    }
  })

  afterAll(() => {
    memoryDb.closeMemoryDb()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('原话、时间范围、跨角色隔离与拒答达到当前基线', async () => {
    expect(recallVerbatim).toBeTypeOf('function')
    const results: Array<{ id: string; kind: string; pass: boolean }> = []
    for (const c of CASES) {
      results.push({ id: c.id, kind: c.kind, pass: await runCase(c) })
    }
    const scored = results.filter((r) => r.kind !== 'semantic')
    const semantic = results.filter((r) => r.kind === 'semantic')
    const passed = scored.filter((r) => r.pass).length
    console.log(
      `[memory-eval] 通过 ${passed}/${scored.length}`,
      scored.filter((r) => !r.pass).map((r) => r.id).join(',') || '无失败',
      `| 语义类基线 ${semantic.filter((r) => r.pass).length}/${semantic.length}`,
    )
    expect(scored.every((r) => r.pass)).toBe(true)
  })
})
