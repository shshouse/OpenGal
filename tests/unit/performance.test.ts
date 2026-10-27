import { describe, expect, it } from 'vitest'
import { parsePerformance } from '../../src/shared/performance'

describe('表演模块', () => {
  it('同一行输出给出原文、展示、语音、皮套四种视图', () => {
    const result = parsePerformance('<e:shy>你回来了。<a:wave>今天怎么样？')
    expect(result.raw).toContain('<e:shy>')
    expect(result.displayText).toBe('你回来了。今天怎么样？')
    expect(result.ttsText).toBe('你回来了。今天怎么样？')
    expect(result.ttsText).not.toContain('<')
    expect(result.segments[0].emotion).toBe('shy')
    expect(result.segments[1].motion).toBe('wave')
  })

  it('纯文本时三种视图一致', () => {
    const result = parsePerformance('嗯，我在。')
    expect(result.raw).toBe('嗯，我在。')
    expect(result.displayText).toBe(result.ttsText)
    expect(result.segments).toHaveLength(1)
  })

  it('未知标签不会进入语音文本', () => {
    const result = parsePerformance('<pause>嗯<e:shy>好。')
    expect(result.ttsText).toBe('嗯好。')
    expect(result.raw).toContain('<pause>')
  })
})
