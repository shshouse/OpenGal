import { describe, expect, it } from 'vitest'
import { getErrorMessage, getErrorStack, isAbortError } from '../../src/shared/errors'

describe('getErrorMessage', () => {
  it('Error 取 message', () => {
    expect(getErrorMessage(new Error('磁盘已满'))).toBe('磁盘已满')
  })

  it('字符串原样返回', () => {
    expect(getErrorMessage('连接超时')).toBe('连接超时')
  })

  it('null 与 undefined 不产生 "[object Object]" 以外的歧义', () => {
    expect(getErrorMessage(null)).toBe('null')
    expect(getErrorMessage(undefined)).toBe('undefined')
  })

  it('普通对象序列化而不是丢失内容', () => {
    expect(getErrorMessage({ code: 'EACCES', path: '/x' })).toBe('{"code":"EACCES","path":"/x"}')
  })

  it('数字与布尔', () => {
    expect(getErrorMessage(500)).toBe('500')
    expect(getErrorMessage(false)).toBe('false')
  })

  it('循环引用不抛错', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => getErrorMessage(cyclic)).not.toThrow()
    expect(typeof getErrorMessage(cyclic)).toBe('string')
  })
})

describe('getErrorStack / isAbortError', () => {
  it('非 Error 没有调用栈', () => {
    expect(getErrorStack('boom')).toBeUndefined()
    expect(getErrorStack({ message: 'x' })).toBeUndefined()
    expect(getErrorStack(new Error('x'))).toBeTypeOf('string')
  })

  it('按 name 判断中断，非 Error 不误判', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(isAbortError(abort)).toBe(true)
    expect(isAbortError(new Error('other'))).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})
