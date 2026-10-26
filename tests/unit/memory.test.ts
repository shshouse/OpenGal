import { describe, expect, it } from 'vitest'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applyCandidates,
  buildMemoryBlock,
  buildMemoryBlockVector,
  clearMemory,
  deleteFact,
  freezeFact,
  initMemoryStore,
  loadFacts,
  loadStories,
  manualAddFact,
  normalizeText,
  relevanceScore,
  retentionScore,
  textSimilarity,
  unfreezeFact,
} from '../../src/main/services/memoryStore'
import {
  addSummary,
  appendMessage,
  archiveMessagesRange,
  clearCharacterMessages,
  closeMemoryDb,
  getMeta,
  latestMessageId,
  listFacts,
  listSummaries,
  listUnarchivedMessages,
  memoryDbReady,
  saveChatMessages,
} from '../../src/main/services/memoryDb'
import { pickTarget } from '../../src/main/services/memoryArbitration'

describe('memory text and adjudication', () => {
  it('归一化与相似度', () => {
    expect(normalizeText('你好， 世界！')).toBe('你好世界')
    expect(textSimilarity('用户的生日是6月12日', '用户的生日是 6 月 12 日')).toBe(1)
    expect(textSimilarity('用户喜欢猫', '用户讨厌下雨')).toBeLessThan(0.6)
  })

  it('缺失或非法确认时间不产生 NaN 分数', () => {
    const base = {
      id: 'score',
      text: '测试事实',
      entity: 'user' as const,
      importance: 3,
      confidence: 0.5,
      source: 'llm_inferred' as const,
      created_at: '',
      last_confirmed_at: '',
      status: 'active' as const,
      evidence: { reinforce: 0, negate: 0 },
      valid_until: null,
      frozen_at: null,
      embedding: null,
    }
    expect(retentionScore(base)).toBe(1)
    expect(retentionScore({ ...base, last_confirmed_at: 'not-a-date' })).toBe(1)
    expect(Number.isFinite(retentionScore({ ...base, last_confirmed_at: new Date().toISOString() }))).toBe(true)
  })

  it('相同与近似事实的裁决', () => {
    const active = [
      {
        id: 'f1',
        text: '用户的生日是6月12日',
        entity: 'user' as const,
        subject: '用户',
        attribute: '生日',
        importance: 10,
        confidence: 1,
        source: 'user_statement' as const,
        created_at: '',
        last_confirmed_at: '',
        status: 'active' as const,
        evidence: { reinforce: 0, negate: 0 },
        valid_until: null,
        frozen_at: null,
        embedding: null,
      },
    ]
    // 重复陈述不再自动强化，只负责找到候选，交给语义裁判
    expect(pickTarget(
      { text: '用户的生日是6月12日', entity: 'user', importance: 10, confidence: 1, reason: 'r' },
      active,
    )).not.toBeNull()
    // 无关事实不产生候选
    expect(pickTarget(
      { text: '用户在准备CP考试', entity: 'user', importance: 6, confidence: 0.5, reason: 'r' },
      active,
    )).toBeNull()
    // 槽位命中优先于字面相似：改日期也能找到旧值
    expect(pickTarget(
      { text: '用户的生日改到7月1日', entity: 'user', subject: '用户', attribute: '生日' },
      active,
    )?.via).toBe('slot')
  })
})

describe('memory persistence pipeline', () => {
  it('迁移、写入、预算、清理、冻结、召回全链路', async () => {
    const root = path.join(os.tmpdir(), `og-vitest-mem-${Date.now()}`)
    try {
      const chatDir = path.join(root, 'chat_history')
      fs.mkdirSync(chatDir, { recursive: true })
      fs.writeFileSync(
        path.join(chatDir, 'c1.json'),
        JSON.stringify({
          version: 1,
          characterId: 'c1',
          messages: [
            { role: 'user', content: '你好' },
            { role: 'assistant', content: '嗨，今天想做点什么？' },
          ],
        }),
      )

      const legacyDir = path.join(root, 'memory', 'c1')
      fs.mkdirSync(legacyDir, { recursive: true })
      fs.writeFileSync(
        path.join(legacyDir, 'facts.json'),
        JSON.stringify([
          {
            id: 'legacy_f1',
            text: '用户的猫叫小饼',
            entity: 'user',
            importance: 7,
            confidence: 0.8,
            source: 'manual',
            created_at: '2025-01-01T00:00:00.000Z',
            last_confirmed_at: '2025-01-01T00:00:00.000Z',
            status: 'active',
            evidence: { reinforce: 2, negate: 0 },
          },
        ]),
      )
      fs.writeFileSync(
        path.join(legacyDir, 'story.json'),
        JSON.stringify([
          {
            id: 'legacy_s1',
            kind: 'milestone',
            text: '第一次见面聊到凌晨',
            occurred_at: '2025-01-01T00:00:00.000Z',
            due_at: null,
            fulfilled: false,
            importance: 6,
            status: 'active',
            created_at: '2025-01-01T00:00:00.000Z',
          },
        ]),
      )

      initMemoryStore(root, {
        injectCharCap: 900,
        batchTurns: 8,
        idleMinutes: 5,
        fallbackHours: 12,
      })
      await memoryDbReady()
      assert.strictEqual(listFacts('c1').length, 1)
      const migratedFacts = await loadFacts('c1')
      assert.strictEqual(migratedFacts.length, 1)
      assert.strictEqual(migratedFacts[0].text, '用户的猫叫小饼')
      assert.strictEqual(migratedFacts[0].protected, true)
      assert.strictEqual(migratedFacts[0].evidence.reinforce, 2)
      assert.strictEqual((await loadStories('c1')).length, 1)
      assert.ok(getMeta('legacy_mem:c1'))
      assert.ok(fs.existsSync(path.join(legacyDir, 'facts.json')))
      assert.ok(fs.existsSync(path.join(legacyDir, 'story.json')))

      const r1 = await applyCandidates('c1', {
        facts: [{ text: '用户的生日是6月12日', entity: 'user', importance: 10, confidence: 1, reason: '明确陈述' }],
        stories: [
          { kind: 'promise', text: '寒假一起看樱花', importance: 8, reason: '明确约定', due_at: '2027-01-20T00:00:00Z' },
          { kind: 'event', text: '考试挂科那晚陪聊到十二点', importance: 7, reason: '共同经历' },
        ],
      })
      assert.strictEqual(r1.insertedFacts, 1)
      assert.strictEqual(r1.insertedStories, 2)

      const block = buildMemoryBlock(await loadFacts('c1'), await loadStories('c1'))
      assert.ok(block?.includes('生日'))
      assert.ok(block?.includes('还没兑现'))
      assert.ok(block?.includes('可能过时'))
      assert.strictEqual(relevanceScore('用户喜欢吃拉面', '完全无关的内容'), 0)
      assert.ok(relevanceScore('用户养了一只蜥蜴当宠物', '蜥蜴') > 0)
      assert.ok(
        relevanceScore('用户明天有会议而且后天也有会议', '会议 安排') >
          relevanceScore('用户养了一只蜥蜴当宠物', '会议 安排'),
      )
      const soon = new Date(Date.now() + 5 * 86400000).toISOString()
      const v2Block = buildMemoryBlock(
        [
          { id: 'fv', text: '完全无关的琐碎事实', entity: 'user', importance: 2, confidence: 0.3, source: 'llm_inferred', created_at: '', last_confirmed_at: '', status: 'active', evidence: { reinforce: 0, negate: 0 }, valid_until: null, frozen_at: null, embedding: null },
        ],
        [
          { id: 'sv', kind: 'promise', text: '寒假一起看樱花', occurred_at: '', due_at: soon, fulfilled: false, importance: 9, status: 'active', created_at: '' },
        ],
        900,
        '今天吃什么',
      )
      assert.ok(v2Block?.includes('樱花'))
      const soonTs = new Date(Date.now() + 3 * 86400000).toISOString()
      const badDueBlock = buildMemoryBlock(
        [
          { id: 'fa', text: '日期损坏的普通事实', entity: 'user', importance: 2, confidence: 0.3, source: 'llm_inferred', created_at: '', last_confirmed_at: '', status: 'active', evidence: { reinforce: 0, negate: 0 }, valid_until: 'not-a-date', frozen_at: null, embedding: null },
          { id: 'fb', text: '临近到期的普通事实', entity: 'user', importance: 2, confidence: 0.3, source: 'llm_inferred', created_at: '', last_confirmed_at: '', status: 'active', evidence: { reinforce: 0, negate: 0 }, valid_until: soonTs, frozen_at: null, embedding: null },
        ],
        [
          { id: 'sb', kind: 'promise', text: '日期损坏的约定', occurred_at: '', due_at: 'garbage', fulfilled: false, importance: 9, status: 'active', created_at: '' },
        ],
        900,
        '今天吃什么',
      )
      assert.ok(badDueBlock?.includes('日期损坏'))
      assert.ok(
        badDueBlock !== null &&
          badDueBlock.indexOf('临近到期') < badDueBlock.indexOf('日期损坏的普通事实'),
      )

      const synced = listUnarchivedMessages('c1')
      assert.strictEqual(synced.length, 2)
      assert.strictEqual(synced[0].role, 'user')
      assert.strictEqual((JSON.parse(synced[0].content) as { content: string }).content, '你好')
      assert.ok(fs.existsSync(path.join(root, 'memory.db')))
      assert.ok(fs.statSync(path.join(root, 'memory.db')).size > 0)
      appendMessage({ character_id: 'c1', role: 'user', content: '"再来一条"', ts: Date.now(), archived: 0 })
      assert.strictEqual(listUnarchivedMessages('c1').length, 3)

      saveChatMessages(
        'm1',
        Array.from({ length: 12 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant' })),
      )
      const m1Rows = listUnarchivedMessages('m1')
      assert.strictEqual(m1Rows.length, 12)
      const fromId = m1Rows[0].id as number
      const toId = m1Rows[6].id as number
      assert.strictEqual(archiveMessagesRange('m1', fromId, toId), 7)
      assert.strictEqual(listUnarchivedMessages('m1').length, 5)
      assert.strictEqual(latestMessageId('m1'), m1Rows[m1Rows.length - 1].id)

      addSummary('m1', { start_ts: 1, end_ts: 2, text: '摘要v1', message_count: 7 })
      addSummary('m1', { start_ts: 3, end_ts: 4, text: '摘要v2', message_count: 9 })
      const sums = listSummaries('m1')
      assert.strictEqual(sums.length, 2)
      assert.strictEqual(sums[0].text, '摘要v1')
      assert.strictEqual(sums[1].text, '摘要v2')
      clearCharacterMessages('m1')
      assert.strictEqual(listUnarchivedMessages('m1').length, 0)

      initMemoryStore(root)
      await clearMemory('c2')
      const r2 = await applyCandidates('c2', {
        facts: [
          { text: '用户喜欢草莓蛋糕和抹茶味的一切甜点', entity: 'user', importance: 6, confidence: 1, reason: 'a' },
          { text: '用户讨厌香菜', entity: 'user', importance: 2, confidence: 1, reason: 'b' },
          { text: '用户在准备CP考试', entity: 'user', importance: 5, confidence: 1, reason: 'c' },
        ],
        stories: [],
      })
      assert.strictEqual(r2.insertedFacts, 3)
      const facts2 = await loadFacts('c2')
      assert.strictEqual(facts2.filter((f) => f.status === 'active').length, 3)
      assert.strictEqual(facts2.filter((f) => f.status === 'archived').length, 0)

      const r3 = await applyCandidates('c2', {
        facts: [{ text: '这一条记忆内容写得非常非常长，长到单独一条就超过了整个心记簿的预算上限，所以无论如何腾位都不可能被接受入库', entity: 'user', importance: 9, confidence: 1, reason: 'c' }],
        stories: [],
      })
      assert.strictEqual(r3.insertedFacts, 1)
      await clearMemory('c2')
      assert.strictEqual((await loadFacts('c2')).length, 0)

      initMemoryStore(root)
      const manual = await manualAddFact('c3', '用户养了一只猫')
      assert.ok(pickTarget(
        { text: '用户家里养了只猫', entity: 'user', importance: 9, confidence: 1, reason: 'r' },
        [manual],
      ))
      const r4 = await applyCandidates(
        'c3',
        {
          facts: [
            { text: '用户家里养了只猫', entity: 'user', importance: 9, confidence: 1, reason: 'a' },
            { text: '用户喜欢骑摩托车兜风', entity: 'user', importance: 8, confidence: 1, reason: 'b' },
          ],
          stories: [],
        },
        async () => [{ index: 0, verdict: 'contradicts' as const }],
      )
      const facts4 = await loadFacts('c3')
      assert.strictEqual(r4.insertedFacts, 2)
      assert.strictEqual(r4.supersededFacts, 1)
      const manualAfter = facts4.find((f) => f.id === manual.id)
      assert.ok(manualAfter && manualAfter.status === 'superseded')
      assert.ok(manualAfter?.invalid_at)
      assert.ok(facts4.some((f) => f.text === '用户家里养了只猫' && f.status === 'active'))

      const c4 = 'c4'
      await clearMemory(c4)
      await applyCandidates(c4, {
        facts: [{ text: '用户去年喜欢打篮球', entity: 'user', importance: 5, confidence: 1, reason: 'r' }],
        stories: [],
      })
      const factsC4 = await loadFacts(c4)
      const oldFact = factsC4.find((f) => f.text.includes('打篮球'))!
      oldFact.last_confirmed_at = new Date(Date.now() - 100 * 86400000).toISOString()
      const { saveFacts } = await import('../../src/main/services/memoryDb')
      saveFacts(c4, factsC4.map((f) => ({
        id: f.id, character_id: c4, text: f.text, entity: f.entity, importance: f.importance,
        confidence: f.confidence, source: f.source, created_at: f.created_at, last_confirmed_at: f.last_confirmed_at,
        status: f.status, evidence_reinforce: f.evidence.reinforce, evidence_negate: f.evidence.negate,
        protected_: f.protected ? 1 : 0, valid_until: null, frozen_at: null, embedding: null,
      })))
      const frozenFact = await manualAddFact(c4, '用户的生日是3月15日')
      await freezeFact(c4, frozenFact.id)
      const factsAfterDecay = await loadFacts(c4)
      assert.strictEqual(factsAfterDecay.find((f) => f.id === oldFact.id)?.status, 'active')
      assert.strictEqual(factsAfterDecay.find((f) => f.id === frozenFact.id)?.status, 'active')
      await unfreezeFact(c4, frozenFact.id)
      assert.strictEqual((await loadFacts(c4)).find((f) => f.id === frozenFact.id)?.frozen_at, null)
      await deleteFact(c4, frozenFact.id)
      assert.ok(!(await loadFacts(c4)).some((f) => f.id === frozenFact.id))

      assert.ok(relevanceScore('用户的生日是3月15日', '生日') > 0.5)
      assert.ok(relevanceScore('用户的生日是3月15日', '完全无关的内容') < 0.3)

      const c5 = 'c5'
      await clearMemory(c5)
      await manualAddFact(c5, '用户喜欢草莓蛋糕')
      await manualAddFact(c5, '用户讨厌香菜')
      const vectorBlock = await buildMemoryBlockVector(c5, await loadFacts(c5), await loadStories(c5), '草莓蛋糕', 900)
      assert.ok(vectorBlock?.includes('草莓蛋糕'))
    } finally {
      closeMemoryDb()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
