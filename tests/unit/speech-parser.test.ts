import { describe, expect, it } from 'vitest'
import { SpeechStreamParser, extractAssistantDisplayText } from '@shared/roleCard'

interface CheckItem {
  text: string
  emotion?: string
  action?: string
}

function collect(parts: string[]): CheckItem[] {
  const parser = new SpeechStreamParser()
  const items: CheckItem[] = []
  for (const part of parts) {
    for (const item of parser.feed(part)) {
      items.push({ text: item.text, emotion: item.emotion, action: item.action })
    }
  }
  for (const item of parser.flush()) {
    items.push({ text: item.text, emotion: item.emotion, action: item.action })
  }
  return items
}

describe('SpeechStreamParser', () => {
  it('按情绪标签切段，整段与逐字输入一致', () => {
    const line = '你回来啦。<e:happy>今天想先听我弹琴，<e:shy>还是先吃饭？'
    const expected = [
      { text: '你回来啦。', emotion: 'neutral', action: undefined },
      { text: '今天想先听我弹琴，', emotion: 'happy', action: undefined },
      { text: '还是先吃饭？', emotion: 'shy', action: undefined },
    ]
    expect(collect([line])).toEqual(expected)
    expect(collect([...line])).toEqual(expected)
  })

  it('处理跨块的标签与句子切分', () => {
    expect(collect(['你好<e:ha', 'ppy>世界。'])).toEqual([
      { text: '你好', emotion: 'neutral', action: undefined },
      { text: '世界。', emotion: 'happy', action: undefined },
    ])
    expect(collect(['你好。今天怎么样？'])).toEqual([
      { text: '你好。', emotion: 'neutral', action: undefined },
      { text: '今天怎么样？', emotion: 'neutral', action: undefined },
    ])
    const action = collect(['<a:kaixin>你好。再见。'])
    expect(action[0].action).toBe('kaixin')
    expect(action[1].action).toBeUndefined()
    const long = collect(['一'.repeat(40)])
    expect(long.length).toBeGreaterThanOrEqual(2)
    expect(long[0].text.length).toBeLessThanOrEqual(12)
    expect(collect(['<e:happy>'])).toEqual([])
  })

  it('解析 JSON segments 与代码块包裹', () => {
    expect(collect(['{"segments":[{"text":"你好","emotion":"happy"},{"text":"世界","emotion":"neutral"}]}'])).toEqual([
      { text: '你好', emotion: 'happy', action: undefined },
      { text: '世界', emotion: 'neutral', action: undefined },
    ])
    expect(collect(['```json\n{"segments":[{"text":"你好","emotion":"happy"}]}\n```'])).toEqual([
      { text: '你好', emotion: 'happy', action: undefined },
    ])
  })

  it('提取展示文本时去掉标签与 JSON 外壳', () => {
    expect(extractAssistantDisplayText('<e:happy>你好。<e:neutral>再见。')).toBe('你好。再见。')
    expect(extractAssistantDisplayText('{"segments":[{"text":"你好"},{"text":"世界"}]}')).toBe('你好世界')
  })
})
