import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listRoleCardsDetailed } from '../../src/main/services/roleCardLoader'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-mod-manifest-'))
const previous = process.env.OPENGAL_MOD_ROOT

function writeCard(folder: string, manifest: unknown, legacy?: unknown) {
  const dir = path.join(root, 'Role', folder)
  fs.mkdirSync(dir, { recursive: true })
  if (manifest) fs.writeFileSync(path.join(dir, 'opengal.json'), JSON.stringify(manifest))
  if (legacy) fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify(legacy))
}

const persona = {
  description: '来自 opengal.json',
  personality: '温柔',
}

beforeAll(() => {
  process.env.OPENGAL_MOD_ROOT = root
  writeCard(
    'sonetto',
    {
      schemaVersion: 1,
      id: 'sonetto',
      name: '十四行诗',
      displayName: '十四行诗',
      language: 'zh',
      windowMode: 'pet',
      color: '#C75B39',
      persona,
      performance: { mode: 'live2d', live2d: { modelPath: 'model/a.model3.json' } },
      resources: { expressions: ['neutral', 'happy'], motions: ['Idle'] },
      voice: { engine: 'gpt-sovits', config: 'voice/config.json' },
    },
    { id: 'sonetto', name: '旧卡', displayName: '旧卡', persona: { description: '来自 character.json', personality: '旧' } },
  )
  writeCard('legacy-only', null, {
    id: 'legacy-only',
    name: '旧角色',
    displayName: '旧角色',
    performance: { mode: 'live2d', live2d: { modelPath: 'model/b.model3.json' } },
    persona: { description: '只有 character.json', personality: '旧' },
  })
})

afterAll(() => {
  if (previous === undefined) delete process.env.OPENGAL_MOD_ROOT
  else process.env.OPENGAL_MOD_ROOT = previous
  fs.rmSync(root, { recursive: true, force: true })
})

describe('模组清单', () => {
  it('存在 opengal.json 时优先于 character.json', () => {
    const loaded = listRoleCardsDetailed()
    const card = loaded.find((item) => item.entry.id === 'sonetto')
    expect(card?.entry.persona.description).toBe('来自 opengal.json')
  })

  it('没有 opengal.json 时回退到 character.json', () => {
    const loaded = listRoleCardsDetailed()
    const legacy = loaded.find((item) => item.entry.id === 'legacy-only')
    expect(legacy?.entry.persona.description).toBe('只有 character.json')
  })

  it('voice.config 映射成角色卡的 configRef', () => {
    const card = listRoleCardsDetailed().find((item) => item.entry.id === 'sonetto')
    expect(card?.entry.voice?.configRef).toBe('voice/config.json')
  })

  it('resources 不参与角色卡校验，不产生 error', () => {
    const card = listRoleCardsDetailed().find((item) => item.entry.id === 'sonetto')
    expect(card?.issues.filter((issue) => issue.severity === 'error')).toEqual([])
  })
})
