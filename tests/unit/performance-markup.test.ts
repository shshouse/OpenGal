import { describe, expect, it } from 'vitest'
import { SpeechStreamParser } from '../../src/shared/roleCard'

function parse(text: string) {
  const parser = new SpeechStreamParser()
  return [...parser.feed(text), ...parser.flush()]
}

describe('行内表演标记', () => {
  it('表情是粘性状态，动作是一次性的', () => {
    const items = parse('<e:happy>你好呀<a:wave>今天怎么样')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ text: '你好呀今天怎么样', emotion: 'happy', action: 'wave' })
  })

  it('动作标签不再强制切段', () => {
    const items = parse('<e:happy>你好呀<a:wave>今天怎么样')
    expect(items).toHaveLength(1)
  })

  it('表情标签仍然切段，用于换表情与换语气', () => {
    const items = parse('<e:happy>早上好。<e:sad>我有点累。')
    expect(items.map((i) => i.text)).toEqual(['早上好。', '我有点累。'])
    expect(items.map((i) => i.emotion)).toEqual(['happy', 'sad'])
  })

  it('未知标签被丢弃，不会被念出来', () => {
    const items = parse('<pause>嗯<e:shy>好。')
    expect(items.map((i) => i.text)).toEqual(['嗯', '好。'])
    expect(items.map((i) => i.emotion)).toEqual(['neutral', 'shy'])
  })

  it('句中的小于号当作正文保留', () => {
    const items = parse('我<3你')
    expect(items.map((i) => i.text)).toEqual(['我<3你'])
  })

  it('未闭合的标签不会泄漏到台词里', () => {
    const items = parse('等一下<e:hap')
    expect(items.map((i) => i.text).join('')).toBe('等一下')
  })
})
