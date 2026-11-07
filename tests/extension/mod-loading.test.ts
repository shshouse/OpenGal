import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listRoleCardsDetailed } from '../../src/main/services/roleCardLoader'

const root = path.resolve('tests/fixtures/role-card-root')
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'og-mod-loading-data-'))
const previous = process.env.OPENGAL_MOD_ROOT
const previousData = process.env.OPENGAL_DATA_DIR

beforeAll(() => {
  process.env.OPENGAL_MOD_ROOT = root
  process.env.OPENGAL_DATA_DIR = dataRoot
})

afterAll(() => {
  if (previous === undefined) delete process.env.OPENGAL_MOD_ROOT
  else process.env.OPENGAL_MOD_ROOT = previous
  if (previousData === undefined) delete process.env.OPENGAL_DATA_DIR
  else process.env.OPENGAL_DATA_DIR = previousData
  fs.rmSync(dataRoot, { recursive: true, force: true })
})

describe('完整角色清单加载', () => {
  it('按 opengal.json 加载固定 fixture，且没有校验错误', () => {
    const cards = listRoleCardsDetailed()
    const card = cards.find((item) => item.entry.id === 'fixture-role')
    expect(card).toBeDefined()
    expect(card?.entry.persona.description).toContain('固定测试角色')
    expect(card?.entry.performance.live2d?.modelPath).toBe('model/fixture.model3.json')
    expect(card?.entry.voice?.configRef).toBe('voice/config.json')
    expect(card?.issues.filter((issue) => issue.severity === 'error')).toEqual([])
  })
})
