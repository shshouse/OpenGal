import { describe, expect, it } from 'vitest'
import { middleEllipsis } from '../../src/renderer/src/lib/filename'

describe('middleEllipsis', () => {
  it('短名原样返回', () => {
    expect(middleEllipsis('a.png', 20)).toBe('a.png')
    expect(middleEllipsis('截图.png', 20)).toBe('截图.png')
  })

  it('超长名保留后缀，头部优先', () => {
    const name = 'screenshot-2026-10-28-at-23.45.12-final.png'
    const out = middleEllipsis(name, 20)
    expect(out).toHaveLength(20)
    expect(out.endsWith('.png')).toBe(true)
    expect(out.startsWith('screensh')).toBe(true)
    expect(out).toContain('…')
  })

  it('没有后缀时也做中间省略', () => {
    const out = middleEllipsis('abcdefghijklmnopqrstuvwxyz', 10)
    expect(out).toBe('abcde…wxyz')
    expect(out).toHaveLength(10)
  })

  it('隐藏文件不当作后缀', () => {
    const out = middleEllipsis('.verylonghiddenfilename', 10)
    expect(out.endsWith('.')).toBe(false)
    expect(out.includes('…')).toBe(true)
  })

  it('后缀过长时不当作后缀', () => {
    const name = 'x.' + 'a'.repeat(20)
    const out = middleEllipsis(name, 12)
    expect(out.endsWith('aaaa')).toBe(true)
    expect(out).toContain('…')
  })

  it('预算不足时退回原名', () => {
    expect(middleEllipsis('abcdefghij.png', 6)).toBe('abcdefghij.png')
  })
})
