import { describe, expect, it } from 'vitest'
import { buildDirectorSystemPrompt } from '../../src/shared/directorPrompt'

describe('导演提示词', () => {
  it('agent 模式围绕用户，并保留默认安静', () => {
    const prompt = buildDirectorSystemPrompt({ roleName: '凯尔希', mode: 'agent' })
    expect(prompt).toContain('凯尔希')
    expect(prompt).toContain('默认是安静')
    expect(prompt).toContain('"action"')
    expect(prompt).not.toContain('你不在等待指令')
  })

  it('life 模式不等待指令，允许自主行动与沉默', () => {
    const prompt = buildDirectorSystemPrompt({ roleName: '凯尔希', mode: 'life' })
    expect(prompt).toContain('你不在等待指令')
    expect(prompt).toContain('沉默')
    expect(prompt).toContain('"action"')
    expect(prompt).not.toContain('默认是安静')
  })

  it('主动时刻的规则只在主动判定时出现', () => {
    const passive = buildDirectorSystemPrompt({ roleName: null, mode: 'agent' })
    const active = buildDirectorSystemPrompt({ roleName: null, mode: 'agent', initiative: true })
    expect(passive).not.toContain('【本次是主动时刻】')
    expect(active).toContain('【本次是主动时刻】')
  })

  it('没有角色名时不写名字规则', () => {
    expect(buildDirectorSystemPrompt({ roleName: null, mode: 'agent' })).not.toContain('用户叫角色名字（')
    expect(buildDirectorSystemPrompt({ roleName: '凯尔希', mode: 'agent' })).toContain('用户叫角色名字（凯尔希）')
  })
})
