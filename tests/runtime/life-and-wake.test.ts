import { describe, expect, it } from 'vitest'
import { evaluateWakeGate } from '../../src/core/harness/wakeGate'
import { buildLifeTickMessages, clampEnergy, parseLifeDecision } from '../../src/core/harness/lifeLoop'
import { createDefaultRoleState } from '../../src/core/role/types'
import { formatStyleAnchorBlock, selectStyleAnchors } from '../../src/core/role/styleAnchor'

describe('Agent 唤醒词门控与连续对话窗口', () => {
  it('开启唤醒词时，未喊名字忽略环境语音，喊名字开启连续对话窗口', () => {
    const ignored = evaluateWakeGate({
      utterance: '今天天气真不错啊',
      now: 1000,
      activeUntil: 0,
      roleNames: ['凯尔希', "Kal'tsit"],
      requireWakeWord: true,
      windowMs: 30_000,
    })
    expect(ignored.allowed).toBe(false)
    expect(ignored.reason).toBe('ignored')

    const woken = evaluateWakeGate({
      utterance: '凯尔希，帮我看一下这份报告',
      now: 2000,
      activeUntil: 0,
      roleNames: ['凯尔希', "Kal'tsit"],
      requireWakeWord: true,
      windowMs: 30_000,
    })
    expect(woken.allowed).toBe(true)
    expect(woken.reason).toBe('wake-word')
    expect(woken.cleanedUtterance).toContain('帮我看一下这份报告')
    expect(woken.nextActiveUntil).toBe(32_000)

    const followUp = evaluateWakeGate({
      utterance: '第二页的数据有问题吗',
      now: 15_000,
      activeUntil: woken.nextActiveUntil,
      roleNames: ['凯尔希'],
      requireWakeWord: true,
      windowMs: 30_000,
    })
    expect(followUp.allowed).toBe(true)
    expect(followUp.reason).toBe('active-window')
    expect(followUp.nextActiveUntil).toBe(45_000)
  })
})

describe('Life 自主认知循环决策解析与文风锚定', () => {
  it('构建包含自我体征与环境的认知心跳提示词，并安全解析多种自主行动', () => {
    const state = createDefaultRoleState(10_000)
    const msgs = buildLifeTickMessages({
      now: 10_000,
      roleName: '初音未来',
      personaSummary: '住在电脑里的歌姬朋友，好奇开朗',
      state,
      recentLifeLogs: [],
      recentChatLines: ['对方: 我先写会儿论文'],
      activeWindowTitle: 'VS Code',
      userIdleSec: 45,
      canSpeakToUser: true,
    })
    expect(msgs).toHaveLength(2)
    expect(msgs[0]?.content).toContain('Life 模式持续自主循环')

    const diaryDecision = parseLifeDecision(
      [
        '```json',
        '{"thought":"看他在认真写代码，别吵他，记篇笔记吧","mood":"relaxed","energyDelta":-3,"activity":"在角落写随笔","action":{"type":"write_diary","title":"安静的深夜","content":"看他敲键盘很有节奏。"},"nextTickSec":180}',
        '```',
      ].join(String.fromCharCode(10)),
    )
    expect(diaryDecision.action).toEqual({
      type: 'write_diary',
      title: '安静的深夜',
      content: '看他敲键盘很有节奏。',
    })
    expect(diaryDecision.nextTickSec).toBe(180)
    expect(clampEnergy(state.energy, diaryDecision.energyDelta)).toBe(82)

    const fallback = parseLifeDecision('完全不是合法JSON')
    expect(fallback.action.type).toBe('rest')
  })

  it('按当前话题动态检索最贴近的角色原声台词作口癖锚定', () => {
    const examples = [
      { user: '身体不舒服', assistant: '先坐下，把最近的作息如实告诉我。' },
      { user: '今天吃什么', assistant: '营养均衡比口味刺激更重要。' },
      { user: '任务完成了', assistant: '辛苦了，去休息吧。' },
    ]
    const picked = selectStyleAnchors(examples, undefined, '我最近熬夜头疼身体不舒服', 2)
    expect(picked[0]?.assistant).toContain('作息')
    const block = formatStyleAnchorBlock(examples, 'ドクター、かけてくれ。', '熬夜身体不舒服')
    expect(block).toContain('角色原声语感锚点')
    expect(block).toContain('作息')
  })
})
