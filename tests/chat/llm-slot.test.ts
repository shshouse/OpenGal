import { describe, expect, it } from 'vitest'
import { resolveSlotConfig } from '@shared/llmSlot'

describe('resolveSlotConfig', () => {
  const main = { baseURL: 'https://main.example.com', apiKey: 'k1', modelName: 'main-model' }
  const sub = { id: 'p1', label: 'Sub', baseURL: 'https://sub.example.com', apiKey: 'k2', modelName: 'sub-model' }

  it('副手未配置或失效时回退主模型', () => {
    expect(resolveSlotConfig(main, [sub], 'p1', 'main')).toEqual({ config: main, isFallback: true })
    expect(resolveSlotConfig(main, [sub], undefined, 'sub')).toEqual({ config: main, isFallback: true })
    expect(resolveSlotConfig(main, [sub], '', 'sub')).toEqual({ config: main, isFallback: true })
    expect(resolveSlotConfig(main, [sub], 'deleted-id', 'sub')).toEqual({ config: main, isFallback: true })
    expect(resolveSlotConfig(main, undefined, 'p1', 'sub')).toEqual({ config: main, isFallback: true })
  })

  it('副手存在时命中副手配置', () => {
    const hit = resolveSlotConfig(main, [sub], 'p1', 'sub')
    expect(hit.config.modelName).toBe('sub-model')
    expect(hit.isFallback).toBe(false)
  })
})
