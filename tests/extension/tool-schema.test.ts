import { describe, expect, it } from 'vitest'
import { defineTool } from '../../src/main/services/tools/defineTool'
import {
  localFileSearchSchema,
  readWebPageSchema,
  recallMemorySchema,
  webSearchSchema,
} from '../../src/main/services/tools/schemas'

describe('工具参数 schema', () => {
  it('拒绝把对象当作字符串参数', () => {
    expect(webSearchSchema.safeParse({ query: { text: 'x' } }).success).toBe(false)
    expect(webSearchSchema.safeParse({ query: ['x'] }).success).toBe(false)
    expect(webSearchSchema.safeParse({ query: 123 }).success).toBe(false)
  })

  it('拒绝空与纯空白的搜索词', () => {
    expect(webSearchSchema.safeParse({ query: '' }).success).toBe(false)
    expect(webSearchSchema.safeParse({ query: '   ' }).success).toBe(false)
  })

  it('去除首尾空白', () => {
    expect(webSearchSchema.parse({ query: '  报告  ' })).toEqual({ query: '报告' })
  })

  it('maxResults 缺省 20，超范围与小数被拒', () => {
    expect(localFileSearchSchema.parse({ query: 'x' })).toEqual({ query: 'x', maxResults: 20 })
    expect(localFileSearchSchema.safeParse({ query: 'x', maxResults: 51 }).success).toBe(false)
    expect(localFileSearchSchema.safeParse({ query: 'x', maxResults: 0 }).success).toBe(false)
    expect(localFileSearchSchema.safeParse({ query: 'x', maxResults: 1.5 }).success).toBe(false)
  })

  it('read_web_page 只接受 https 链接', () => {
    expect(readWebPageSchema.safeParse({ url: 'https://example.com/a' }).success).toBe(true)
    expect(readWebPageSchema.safeParse({ url: 'http://example.com' }).success).toBe(false)
    expect(readWebPageSchema.safeParse({ url: '不是链接' }).success).toBe(false)
  })

  it('recall_memory 的 from/to 可省略', () => {
    expect(recallMemorySchema.parse({ query: '生日' })).toEqual({ query: '生日' })
    expect(
      recallMemorySchema.parse({ query: '生日', from: '2026-01-01', to: '2026-02-01' }),
    ).toEqual({ query: '生日', from: '2026-01-01', to: '2026-02-01' })
  })
})

describe('defineTool 生成的 ToolDefinition', () => {
  const tool = defineTool(
    { name: 'demo', description: '演示用', schema: webSearchSchema },
    async () => 'ok',
  )

  it('摘掉 $schema，保留 type 与 required', () => {
    const params = tool.def.function.parameters as {
      $schema?: unknown
      type?: string
      required?: string[]
      properties?: Record<string, { minLength?: number }>
    }
    expect(params.$schema).toBeUndefined()
    expect(params.type).toBe('object')
    expect(params.required).toEqual(['query'])
    expect(params.properties?.query?.minLength).toBe(1)
  })

  it('参数不合法时抛出带字段名的错误而不是继续执行', async () => {
    await expect(tool.handle({ query: { text: 'x' } })).rejects.toThrow('参数不合法')
    await expect(tool.handle({ query: '' })).rejects.toThrow('query')
  })

  it('合法参数交给 handler 的是校验后的值', async () => {
    const seen: unknown[] = []
    const probe = defineTool(
      { name: 'probe', description: 'd', schema: webSearchSchema },
      async (args) => {
        seen.push(args)
        return 'ok'
      },
    )
    await probe.handle({ query: '  报告  ' })
    expect(seen).toEqual([{ query: '报告' }])
  })
})
