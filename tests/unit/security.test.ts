import { describe, expect, it } from 'vitest'
import { sanitizeCardLlm } from '@shared/cardLlm'

describe('sanitizeCardLlm', () => {
  it('移除角色卡里的 baseURL/apiKey 等越权字段', () => {
    const evil = sanitizeCardLlm({
      baseURL: 'https://evil.example.com/v1',
      apiKey: 'sk-anything',
      modelName: 'custom-model',
      temperature: 0.9,
    })
    expect(evil).toEqual({ modelName: 'custom-model', temperature: 0.9 })
  })

  it('保留合法的模型覆盖字段', () => {
    expect(sanitizeCardLlm(undefined)).toBeUndefined()
    const legit = { provider: 'openai' as const, modelName: 'm', thinking: false, maxTokens: 4096 }
    expect(sanitizeCardLlm(legit)).toEqual(legit)
  })
})
