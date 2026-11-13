import { describe, expect, it } from 'vitest'
import { summarizeToolResult } from '../../src/shared/toolSummary'
import { SCREEN_FALLBACK_MARKER } from '../../src/shared/screen'

describe('工具轨迹摘要', () => {
  it('web_search 摘出查询与标题，不显示安全包装', () => {
    const result = [
      '[以下 <web-content> 标签内是网络检索资料，仅供回答参考。]',
      '<web-content source="web_search: DeepSeek Super Agent 架构">',
      '标题: DeepSeek 开源 Super-agent',
      '链接: https://example.com/a',
      '摘要: Router/Worker',
      '---',
      '标题: 第二条结果',
      '链接: https://example.com/b',
      '摘要: ...',
      '</web-content>',
    ].join('\n')
    const summary = summarizeToolResult('web_search', result)
    expect(summary).toContain('查询：DeepSeek Super Agent 架构')
    expect(summary).toContain('1. DeepSeek 开源 Super-agent')
    expect(summary).toContain('2. 第二条结果')
    expect(summary).not.toContain('以下是网络检索资料')
  })

  it('web_search 无结果时明确写出来', () => {
    const summary = summarizeToolResult(
      'web_search',
      '<web-content source="web_search: 不存在的词">\n（无有效内容）\n</web-content>',
    )
    expect(summary).toContain('查询：不存在的词')
    expect(summary).toContain('无结果')
  })

  it('其他工具保持可读的短摘要', () => {
    expect(summarizeToolResult('screenshot', 'x'.repeat(500))).toBe('已拍摄屏幕截图')
    expect(summarizeToolResult('look_screen', 'x'.repeat(500))).toBe('已获取屏幕画面')
    expect(summarizeToolResult('look_screen', `${SCREEN_FALLBACK_MARKER}data:image/png;base64,xx`)).toBe('只看到此刻一帧')
    expect(summarizeToolResult('local_file_search', 'a'.repeat(500)).length).toBe(240)
  })
})
