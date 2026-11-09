import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as memoryDb from '../../src/main/services/memoryDb'
import * as memoryStore from '../../src/main/services/memory'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-injection-'))
const DAY = 86_400_000
const NOW = Date.now()
const ago = (days: number): string => new Date(NOW - days * DAY).toISOString()
const later = (days: number): string => new Date(NOW + days * DAY).toISOString()

interface FactSeed {
  id: string
  text: string
  subject?: string | null
  attribute?: string | null
  object?: string | null
  polarity?: number
  importance?: number
  source?: string
  createdDaysAgo?: number
  validUntil?: string | null
}

function fact(roleId: string, seed: FactSeed): memoryDb.FactRow {
  const created = ago(seed.createdDaysAgo ?? 1)
  return {
    id: seed.id,
    role_id: roleId,
    text: seed.text,
    entity: 'user',
    subject: seed.subject === undefined ? '用户' : seed.subject,
    attribute: seed.attribute === undefined ? `属性${seed.id}` : seed.attribute,
    object: seed.object ?? null,
    polarity: seed.polarity ?? 1,
    importance: seed.importance ?? 5,
    confidence: 1,
    source: seed.source ?? 'user_statement',
    created_at: created,
    last_confirmed_at: created,
    status: 'active',
    evidence_reinforce: 0,
    evidence_negate: 0,
    protected_: 0,
    valid_until: seed.validUntil ?? null,
    frozen_at: null,
    embedding: null,
    source_evidence: null,
    valid_from: created,
    invalid_at: null,
    superseded_by: null,
  }
}

function story(roleId: string, id: string, text: string, dueAt: string | null): memoryDb.StoryRow {
  const created = ago(1)
  return {
    id,
    role_id: roleId,
    kind: 'promise',
    text,
    occurred_at: created,
    due_at: dueAt,
    fulfilled: 0,
    importance: 7,
    status: 'active',
    created_at: created,
    source_evidence: null,
  }
}

function seed(): void {
  memoryDb.insertFactRow('c-job', fact('c-job', { id: 'j-old', text: '用户以前在腾讯做后端', attribute: '职业', object: '腾讯', createdDaysAgo: 300, importance: 8 }))
  memoryDb.insertFactRow('c-job', fact('c-job', { id: 'j-new', text: '用户现在在字节跳动做后端', attribute: '职业', object: '字节跳动', createdDaysAgo: 2, importance: 8 }))

  memoryDb.insertFactRow('c-focus', fact('c-focus', { id: 'f-interview', text: '用户周三要去字节三面', attribute: '面试安排', object: '字节三面', createdDaysAgo: 2, importance: 6 }))
  memoryDb.insertFactRow('c-focus', fact('c-focus', { id: 'f-cat', text: '用户的猫叫年糕', attribute: '猫的名字', object: '年糕', createdDaysAgo: 200, importance: 10 }))
  memoryDb.insertFactRow('c-focus', fact('c-focus', { id: 'f-city', text: '用户住在杭州', attribute: '居住城市', object: '杭州', createdDaysAgo: 120, importance: 6 }))

  memoryDb.insertFactRow('c-neg', fact('c-neg', { id: 'n-coriander', text: '用户不吃香菜', attribute: '饮食偏好', object: '香菜', polarity: 0, createdDaysAgo: 40, importance: 6 }))
  memoryDb.insertFactRow('c-neg', fact('c-neg', { id: 'n-spicy', text: '用户很能吃辣', attribute: '饮食偏好', object: '辣', createdDaysAgo: 60, importance: 5 }))

  memoryDb.insertFactRow('c-expire', fact('c-expire', { id: 'e-jp', text: '用户最近在学日语', attribute: '近期学习', object: '日语', createdDaysAgo: 90, importance: 5, validUntil: ago(30) }))
  memoryDb.insertFactRow('c-expire', fact('c-expire', { id: 'e-run', text: '用户每周三去跑步', attribute: '运动习惯', object: '跑步', createdDaysAgo: 10, importance: 5 }))

  memoryDb.insertStoryRow('c-promise', story('c-promise', 'p-hotpot', '下周三一起去吃火锅', later(3)))

  memoryDb.insertFactRow('c-other', fact('c-other', { id: 'o-cat', text: '用户的猫叫年糕', attribute: '猫的名字', object: '年糕', createdDaysAgo: 30, importance: 10 }))

  for (let i = 0; i < 40; i++) {
    memoryDb.insertFactRow('c-budget', fact('c-budget', {
      id: `b-${i}`,
      text: `用户在项目 ${i} 里负责一个独立的后端模块`,
      attribute: '项目经历',
      object: `项目${i}`,
      createdDaysAgo: i + 1,
      importance: 4,
    }))
  }

  const noise = ['同事叫李雷', '公司楼下有家面馆', '上周开了一次季度会', '地铁七号线直达', '键盘是青轴的', '周末通常睡到十点', '手机套餐 59 元', '衣柜里有两件黑衬衫']
  noise.forEach((text, i) => {
    memoryDb.insertFactRow('c-noise', fact('c-noise', { id: `z-${i}`, text: `用户提到${text}`, attribute: `杂项${i}`, createdDaysAgo: 20 + i, importance: 3 }))
  })
  memoryDb.insertFactRow('c-noise', fact('c-noise', { id: 'z-target', text: '用户养了一只叫年糕的橘猫', attribute: '猫的名字', object: '年糕', createdDaysAgo: 15, importance: 7 }))
}

interface Case {
  id: string
  role: string
  query: string
  expect?: string[]
  reject?: string[]
  charCap?: number
  maxChars?: number
  empty?: boolean
}

const CASES: Case[] = [
  { id: '改口后取当前值', role: 'c-job', query: '我现在在哪上班', expect: ['字节跳动'], reject: ['腾讯'] },
  { id: '强相关低重要度优先', role: 'c-focus', query: '周三的面试准备得怎么样', expect: ['三面'], reject: ['年糕'], charCap: 12 },
  { id: '否定偏好仍要注入', role: 'c-neg', query: '晚上点外卖有什么要注意的', expect: ['香菜'] },
  { id: '过期事实不再注入', role: 'c-expire', query: '我最近在学什么', reject: ['日语'], expect: ['跑步'] },
  { id: '约定要出现在关系区', role: 'c-promise', query: '我们最近有什么事', expect: ['火锅'] },
  { id: '问及过去时给历史值', role: 'c-job', query: '我以前是做什么工作的', expect: ['腾讯'] },
  { id: '不串到别的角色', role: 'c-empty', query: '我的猫叫什么', reject: ['年糕'], empty: true },
  { id: '预算截断', role: 'c-budget', query: '我在项目里负责什么', charCap: 300, maxChars: 420 },
  { id: '噪音场景保持精准', role: 'c-noise', query: '我那只橘猫叫什么', expect: ['年糕'], reject: ['同事叫李雷', '季度会', '手机套餐'], charCap: 14 },
]

interface Result {
  id: string
  pass: boolean
  chars: number
  block: string | null
}

async function runCase(c: Case): Promise<Result> {
  const block = await memoryStore.getMemoryBlock(c.role, c.query, false, c.charCap ?? 900)
  if (c.empty) {
    return { id: c.id, pass: block === null, chars: 0, block }
  }
  const problems: string[] = []
  for (const word of c.expect ?? []) {
    if (!block?.includes(word)) problems.push(`缺 ${word}`)
  }
  for (const word of c.reject ?? []) {
    if (block?.includes(word)) problems.push(`多了 ${word}`)
  }
  if (c.maxChars && (block?.length ?? 0) > c.maxChars) problems.push(`超预算 ${block?.length}`)
  return { id: c.id, pass: problems.length === 0, chars: block?.length ?? 0, block }
}

describe('记忆注入评测', () => {
  beforeAll(async () => {
    await memoryDb.initMemoryDb(root)
    await memoryDb.memoryDbReady()
    seed()
  })

  afterAll(() => {
    memoryDb.closeMemoryDb()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('逐条跑完注入用例并输出基线', async () => {
    const results: Result[] = []
    for (const c of CASES) results.push(await runCase(c))

    const passed = results.filter((r) => r.pass).length
    const lines = results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(16, ' ')}  ${r.chars} 字`)
    console.log(`\n记忆注入基线：${passed}/${results.length}\n${lines.join('\n')}`)

    const failed = results.filter((r) => !r.pass)
    if (failed.length > 0) {
      console.log('\n未通过的用例：')
      for (const r of failed) {
        console.log(`\n[${r.id}] chars=${r.chars}\n${r.block ?? '(null)'}`)
      }
    }

    expect(results.length).toBe(CASES.length)
  })
})
