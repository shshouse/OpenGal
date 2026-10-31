import { describe, expect, it } from 'vitest'
import { optionalString, requireString } from '../../src/main/services/tools/args'

describe('tool args', () => {
  it('接受字符串并去除首尾空白', () => {
    expect(requireString({ query: '  报告  ' }, 'query')).toBe('报告')
  })

  it('对象参数报错而不是变成 [object Object]', () => {
    expect(() => requireString({ query: { text: 'x' } }, 'query')).toThrow(
      '参数 query 必须是字符串，实际收到 object',
    )
    expect(() => requireString({ query: ['x'] }, 'query')).toThrow('实际收到 array')
    expect(() => requireString({ query: 123 }, 'query')).toThrow('实际收到 number')
  })

  it('缺失与空白分别报错', () => {
    expect(() => requireString({}, 'query')).toThrow('缺少参数 query')
    expect(() => requireString({ query: null }, 'query')).toThrow('缺少参数 query')
    expect(() => requireString({ query: '   ' }, 'query')).toThrow('参数 query 不能为空')
  })

  it('optionalString 把缺失与空白都视为未提供', () => {
    expect(optionalString({}, 'from')).toBeUndefined()
    expect(optionalString({ from: null }, 'from')).toBeUndefined()
    expect(optionalString({ from: '   ' }, 'from')).toBeUndefined()
    expect(optionalString({ from: '2026-01-01' }, 'from')).toBe('2026-01-01')
  })

  it('optionalString 仍然拒绝错误类型', () => {
    expect(() => optionalString({ from: 1 }, 'from')).toThrow(
      '参数 from 必须是字符串，实际收到 number',
    )
  })
})
