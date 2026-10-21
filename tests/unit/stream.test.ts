import { describe, expect, it } from 'vitest'
import { DialogueStreamParser } from '@shared/roleCard'
import { splitChunk } from '../../src/main/services/llm/chunkSplit'

describe('DialogueStreamParser', () => {
  it('解析完整对象与分段对象', () => {
    expect(new DialogueStreamParser().feed('{"text":"你好","emotion":"happy"}')).toEqual([
      { text: '你好', emotion: 'happy' },
    ])
    const parser = new DialogueStreamParser()
    expect(parser.feed('{"text":"我今')).toEqual([])
    expect(parser.feed('天很好"}')).toEqual([{ text: '我今天很好' }])
    expect(new DialogueStreamParser().feed('{"text":"a"}{"text":"b"}')).toHaveLength(2)
    expect(new DialogueStreamParser().feed('{"segments":[{"text":"第一句"},{"text":"第二句"}]}')).toEqual([
      { text: '第一句' },
      { text: '第二句' },
    ])
  })

  it('忽略非文本对象与未完成输入', () => {
    const items = new DialogueStreamParser().feed('{"ok":true}{"text":"好"}')
    expect(items).toHaveLength(1)
    expect(items[0].text).toBe('好')
    const unfinished = new DialogueStreamParser()
    unfinished.feed('{"text":"未完')
    expect(unfinished.flush()).toEqual([])
  })

  it('正确处理字符串内的花括号与转义引号', () => {
    expect(new DialogueStreamParser().feed('{"text":"a}b"}')).toEqual([{ text: 'a}b' }])
    const parser = new DialogueStreamParser()
    expect(parser.feed('{"text":"前')).toEqual([])
    expect(parser.feed('半}半')).toEqual([])
    expect(parser.feed('段"}')).toEqual([{ text: '前半}半段' }])
    expect(new DialogueStreamParser().feed('{"text":"a\\"b"}')).toEqual([{ text: 'a"b' }])
  })
})

describe('splitChunk', () => {
  it('拆分 thinking 标签并维护跨块状态', () => {
    let state = { insideThinkBlock: false }
    expect(splitChunk('hello', state)).toEqual({ content: 'hello', reasoning: '' })
    expect(state.insideThinkBlock).toBe(false)

    state = { insideThinkBlock: false }
    expect(splitChunk('<think>推理</think>回答', state)).toEqual({ content: '回答', reasoning: '推理' })

    state = { insideThinkBlock: false }
    expect(splitChunk('前<think>推', state)).toEqual({ content: '前', reasoning: '推' })
    expect(state.insideThinkBlock).toBe(true)
    expect(splitChunk('理中', state)).toEqual({ content: '', reasoning: '理中' })
    expect(splitChunk('完毕</think>后文', state)).toEqual({ content: '后文', reasoning: '完毕' })
    expect(state.insideThinkBlock).toBe(false)

    state = { insideThinkBlock: false }
    expect(splitChunk('a<thinking>x</thinking>b', state)).toEqual({ content: 'ab', reasoning: 'x' })

    state = { insideThinkBlock: false }
    expect(splitChunk('<think>never closes', state)).toEqual({ content: '', reasoning: 'never closes' })
    expect(state.insideThinkBlock).toBe(true)
  })
})
