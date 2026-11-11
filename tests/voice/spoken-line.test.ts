import { afterEach, describe, expect, it } from 'vitest'
import type { TTSOutputMessage } from '@shared/messages'
import { pipelineBus } from '../../src/renderer/src/features/pipeline/pipelineBus'
import { startSpokenLineBridge, useSpokenLineStore } from '../../src/renderer/src/features/pipeline/spokenLine'
import { subtitleForSegment, useSubtitleStore } from '../../src/renderer/src/features/pipeline/subtitles'

const bridges: Array<() => void> = []

function start(): void {
  bridges.push(startSpokenLineBridge())
}

function segment(id: string, text: string, audioUrl = 'blob:speech'): void {
  pipelineBus.emit('tts:segmentStart', {
    segmentId: id,
    roleId: 'role',
    text,
    audioUrl,
    name: 'role',
  } satisfies TTSOutputMessage)
}

afterEach(() => {
  while (bridges.length) bridges.pop()!()
  useSpokenLineStore.setState({ mode: 'pending', text: '', segmentId: null, roleId: null })
})

describe('spoken line', () => {
  it('有音频的回合按句跟随，文本与段 id 同步更新', () => {
    start()
    segment('a', '第一句。')
    expect(useSpokenLineStore.getState()).toMatchObject({ mode: 'speech', text: '第一句。', segmentId: 'a' })
    segment('b', '第二句。')
    expect(useSpokenLineStore.getState()).toMatchObject({ mode: 'speech', text: '第二句。', segmentId: 'b' })
  })

  it('第一段没有音频时整轮回退到整段文字', () => {
    start()
    segment('a', '第一句。', '')
    segment('b', '第二句。')
    expect(useSpokenLineStore.getState()).toMatchObject({ mode: 'text', text: '第二句。' })
  })

  it('用户输入和中断都清空当前台词', () => {
    start()
    segment('a', '第一句。')
    pipelineBus.emit('user:input', { text: '你好', source: 'user' })
    expect(useSpokenLineStore.getState()).toMatchObject({ mode: 'pending', text: '', segmentId: null })
    segment('b', '第二句。')
    pipelineBus.emit('pipeline:abort', undefined)
    expect(useSpokenLineStore.getState()).toMatchObject({ mode: 'pending', text: '' })
  })
})

describe('subtitleForSegment', () => {
  it('按段 id 取译文，未命中时保留原文', () => {
    useSubtitleStore.setState({
      preferences: { mode: 'translated', targetLanguage: 'system' },
      records: [{ id: 'role:1', roleId: 'role', segments: [{ id: 'a', text: 'こんにちは。', translation: '你好。' }] }],
    } as never)
    expect(subtitleForSegment('role', 'a', 'こんにちは。')).toBe('你好。')
    expect(subtitleForSegment('role', 'missing', '原文')).toBe('原文')
    expect(subtitleForSegment('other', 'a', 'こんにちは。')).toBe('こんにちは。')
    expect(subtitleForSegment('role', null, '原文')).toBe('原文')
  })
})
