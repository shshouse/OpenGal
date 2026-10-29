import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import { listRoleCardsDetailed } from '../../src/main/services/roleCardLoader'

const root = path.resolve('tests/fixtures/role-card-root')
const previous = process.env.OPENGAL_MOD_ROOT

beforeAll(() => {
  process.env.OPENGAL_MOD_ROOT = root
})

afterAll(() => {
  if (previous === undefined) delete process.env.OPENGAL_MOD_ROOT
  else process.env.OPENGAL_MOD_ROOT = previous
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
