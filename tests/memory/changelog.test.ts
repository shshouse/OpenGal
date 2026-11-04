import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  closeMemoryDb,
  deleteFactRow,
  getFactRow,
  initMemoryDb,
  insertFactRow,
  listCharacterMemoryChanges,
  listMemoryChanges,
  memoryDbReady,
  restoreMemoryChange,
  saveFacts,
  setFactStatusRow,
  type FactRow,
} from '../../src/main/services/memoryDb'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-changelog-'))

function fact(characterId: string, id: string, overrides: Partial<FactRow> = {}): FactRow {
  return {
    id,
    character_id: characterId,
    text: `事实 ${id}`,
    entity: 'user',
    subject: null,
    attribute: null,
    importance: 5,
    confidence: 0.8,
    source: 'user_statement',
    created_at: '2026-01-01T00:00:00.000Z',
    last_confirmed_at: '2026-01-01T00:00:00.000Z',
    status: 'active',
    evidence_reinforce: 0,
    evidence_negate: 0,
    protected_: 0,
    valid_until: null,
    frozen_at: null,
    embedding: null,
    source_evidence: null,
    ...overrides,
  }
}

describe('memory changelog', () => {
  beforeAll(async () => {
    await initMemoryDb(root)
    await memoryDbReady()
  })

  afterAll(() => {
    closeMemoryDb()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('新增记忆留下创建记录', () => {
    insertFactRow('c1', fact('c1', 'f1'), 'llm')
    const changes = listMemoryChanges('c1', 'f1')
    expect(changes).toHaveLength(1)
    expect(changes[0].action).toBe('insert')
    expect(changes[0].actor).toBe('llm')
  })

  it('状态变更记录旧值与新值', () => {
    setFactStatusRow('f1', 'archived')
    const [latest] = listMemoryChanges('c1', 'f1')
    expect(latest.action).toBe('update')
    expect(latest.field).toBe('state')
    expect(latest.old_value).toBe('active')
    expect(latest.new_value).toBe('archived')
  })

  it('回滚把状态改回上一步', () => {
    const [latest] = listMemoryChanges('c1', 'f1')
    expect(restoreMemoryChange('c1', latest.seq)).toBe(true)
    expect(getFactRow('f1')?.status).toBe('active')
  })

  it('删除记录整行快照并可恢复', () => {
    deleteFactRow('f1')
    expect(getFactRow('f1')).toBeNull()
    const [latest] = listMemoryChanges('c1', 'f1')
    expect(latest.action).toBe('delete')
    expect(latest.old_value).toContain('f1')
    expect(restoreMemoryChange('c1', latest.seq)).toBe(true)
    expect(getFactRow('f1')?.status).toBe('active')
  })

  it('批量重写只留一条汇总', () => {
    saveFacts('c2', [fact('c2', 'f2'), fact('c2', 'f3')])
    const changes = listCharacterMemoryChanges('c2')
    expect(changes).toHaveLength(1)
    expect(changes[0].reason).toBe('rewrite_facts')
    expect(changes[0].new_value).toBe('2')
  })

  it('不同角色互不可见', () => {
    expect(listMemoryChanges('c9', 'f1')).toHaveLength(0)
  })
})
