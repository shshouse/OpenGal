import { describe, expect, it } from 'vitest'
import { CARD_SCHEMA_VERSION, isSafeCardRelativePath, validateRoleCard } from '@shared/roleCardSchema'

function baseCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: '测试角色',
    performance: { mode: 'live2d', live2d: { modelPath: 'model/role.model3.json' } },
    persona: { description: '设定', personality: '性格' },
    ...overrides,
  }
}

describe('isSafeCardRelativePath', () => {
  it('接受普通相对路径', () => {
    expect(isSafeCardRelativePath('model/role.model3.json')).toBe(true)
    expect(isSafeCardRelativePath('a\\b\\c.json')).toBe(true)
  })

  it('拒绝绝对路径与越界路径', () => {
    for (const value of ['/etc/passwd', 'C:/Windows/win.ini', 'D:\\x', '../outside.json', 'a/../../b', '']) {
      expect(isSafeCardRelativePath(value)).toBe(false)
    }
  })
})

describe('validateRoleCard', () => {
  it('合法卡通过并归一化默认值', () => {
    const result = validateRoleCard(baseCard(), 'my-card')
    expect(result.ok).toBe(true)
    expect(result.card?.id).toBe('my-card')
    expect(result.card?.windowMode).toBe('pet')
    expect(result.card?.name).toBe('测试角色')
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
  })

  it('缺少 name、persona、performance 时报错且不返回卡片', () => {
    for (const broken of [{}, { name: 'x' }, { name: 'x', persona: {} }, { name: 'x', performance: {} }]) {
      const result = validateRoleCard(broken, 'f')
      expect(result.ok).toBe(false)
      expect(result.card).toBeUndefined()
    }
  })

  it('live2d 模式缺少 modelPath 时报错', () => {
    const result = validateRoleCard(
      baseCard({ performance: { mode: 'live2d' } }),
      'f',
    )
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.path === 'performance.live2d' && i.severity === 'error')).toBe(true)
  })

  it('绝对路径与越界路径被拒绝', () => {
    const abs = validateRoleCard(
      baseCard({ performance: { mode: 'live2d', live2d: { modelPath: 'C:/evil/model.json' } } }),
      'f',
    )
    expect(abs.ok).toBe(false)
    expect(abs.issues.some((i) => i.code === 'unsafe-path')).toBe(true)

    const escape = validateRoleCard(
      baseCard({ voice: { configRef: '../../secret.json' } }),
      'f',
    )
    expect(escape.ok).toBe(false)
  })

  it('llm 越权字段被丢弃并记 warning，但不影响可用', () => {
    const result = validateRoleCard(
      baseCard({ llm: { temperature: 0.8, baseURL: 'https://evil.example.com', apiKey: 'sk-x' } }),
      'f',
    )
    expect(result.ok).toBe(true)
    expect(result.card?.llm).toEqual({ temperature: 0.8 })
    const forbidden = result.issues.filter((i) => i.code === 'forbidden-key')
    expect(forbidden.map((i) => i.path).sort()).toEqual(['llm.apiKey', 'llm.baseURL'])
  })

  it('未知顶层字段只记 warning', () => {
    const result = validateRoleCard(baseCard({ mystery: 1 }), 'f')
    expect(result.ok).toBe(true)
    expect(result.issues.some((i) => i.code === 'unknown-key' && i.severity === 'warning')).toBe(true)
  })

  it('未来版本的角色卡被拒绝', () => {
    const result = validateRoleCard(baseCard({ schemaVersion: CARD_SCHEMA_VERSION + 1 }), 'f')
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.code === 'version')).toBe(true)
  })

  it('颜色与 id 格式不合规时降级为警告', () => {
    expect(validateRoleCard(baseCard({ color: '#3291ff' }), 'f').ok).toBe(true)
    const badColor = validateRoleCard(baseCard({ color: 'blue' }), 'f')
    expect(badColor.ok).toBe(true)
    expect(badColor.card?.color).toBeUndefined()

    expect(validateRoleCard(baseCard({ id: 'ok-id_1' }), 'f').ok).toBe(true)
    const badId = validateRoleCard(baseCard({ id: '带空格 的id' }), 'folder-x')
    expect(badId.ok).toBe(true)
    expect(badId.card?.id).toBe('folder-x')
  })

  it('超长文本被拒绝', () => {
    const result = validateRoleCard(
      baseCard({ persona: { description: 'x'.repeat(20_001), personality: 'y' } }),
      'f',
    )
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.code === 'too-long')).toBe(true)
  })

  it('sprite 模式缺少目录时按模式报错', () => {
    const result = validateRoleCard(baseCard({ performance: { mode: 'sprite' } }), 'f')
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.path === 'performance.sprite')).toBe(true)
  })
})
