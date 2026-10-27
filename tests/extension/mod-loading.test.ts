import { afterAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import { listRoleCardsDetailed } from '../../src/main/services/roleCardLoader'

const previous = process.env.OPENGAL_MOD_ROOT

afterAll(() => {
  if (previous === undefined) delete process.env.OPENGAL_MOD_ROOT
  else process.env.OPENGAL_MOD_ROOT = previous
})

describe('真实模组包加载', () => {
  it('十四行诗按 opengal.json 加载，且没有校验错误', () => {
    process.env.OPENGAL_MOD_ROOT = path.resolve('mods')
    const cards = listRoleCardsDetailed()
    const sonetto = cards.find((c) => c.entry.id === 'sonetto')
    expect(sonetto).toBeDefined()
    expect(sonetto?.entry.persona.description).toContain('十四行诗')
    expect(sonetto?.entry.performance?.live2d?.modelPath).toContain('302301_shisihangshi')
    expect(sonetto?.entry.voice?.configRef).toBe('voice/gpt-sovits/config.json')
    expect(sonetto?.issues.filter((i) => i.severity === 'error')).toEqual([])
  })
})
