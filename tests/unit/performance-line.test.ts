import { describe, expect, it } from 'vitest'
import { parsePerformanceLine } from '../../src/shared/performanceLine'

describe('导演直出台词的解析', () => {
  it('把带标记的一行拆成可播放的分段', () => {
    const messages = parsePerformanceLine('<e:shy>你回来了。<e:happy>今天过得怎么样？', '凯尔希')
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ name: '凯尔希', text: '你回来了。', emotion: 'shy' })
    expect(messages[1]).toMatchObject({ text: '今天过得怎么样？', emotion: 'happy' })
  })

  it('纯文本也能正常返回一段', () => {
    const messages = parsePerformanceLine('嗯，我在。', '凯尔希')
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe('嗯，我在。')
  })

  it('标记不会出现在台词文本里', () => {
    const messages = parsePerformanceLine('<a:wave>嗨<e:happy>呀', '凯尔希')
    expect(messages.every((m) => !m.text.includes('<'))).toBe(true)
  })
})
