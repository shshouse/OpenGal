import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ASRConfig, EnvSnapshot } from '../../src/shared/types'

const state = vi.hoisted(() => ({
  directorMode: 'life' as 'agent' | 'life',
  justReturned: true,
  inputs: [] as Array<{ text: string; source: string }>,
  evaluateCalls: 0,
  sending: [] as boolean[],
}))

vi.mock('@/features/pipeline/pipelineBus', () => ({
  pipelineBus: {
    on: () => () => {},
    emit: (event: string, input: { text: string; source: string }) => {
      if (event === 'user:input') state.inputs.push(input)
    },
  },
}))
vi.mock('@/features/director/directorWorker', () => ({
  evaluateInitiative: async () => {
    state.evaluateCalls++
    return { action: { type: 'speak' }, reason: '用户安静已久', urgency: 'low' }
  },
  takeInitiativeBudget: () => true,
}))
vi.mock('@/features/director/directorContract', () => ({
  describeAction: () => 'speak',
}))
vi.mock('@/features/chat/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      isSending: false,
      setSending: (value: boolean) => state.sending.push(value),
    }),
  },
}))
vi.mock('@/features/logs/logsStore', () => ({
  useLogsStore: { getState: () => ({ appendLocal: () => {} }) },
}))
vi.mock('@/features/role/roleStore', () => ({
  useRoleStore: {
    getState: () => ({
      activeId: 'miku',
      list: [{ id: 'miku', mode: 'agent', language: 'zh' }],
    }),
  },
}))
vi.mock('@/features/role/roleRuntimeStore', () => ({
  useRoleRuntimeStore: { getState: () => ({ byId: { miku: true } }) },
}))

function asrConfig(): ASRConfig {
  return {
    enabled: true,
    engine: 'sherpa',
    mode: 'offline',
    modelPath: '',
    language: 'zh',
    sampleRate: 16000,
    autoSend: true,
    deviceId: '',
    hotwords: [],
    vadSilenceMs: 600,
    directorEnabled: true,
    directorMode: state.directorMode,
    directorDirectSpeech: false,
    directorScreenContext: false,
    directorCooldownSec: 20,
    directorInitiativeEnabled: true,
    directorInitiativePerHour: 3,
    directorIdleMinutes: 10,
  }
}

function envSnapshot(): EnvSnapshot {
  return {
    timeText: '09:00',
    idleSeconds: 0,
    justReturned: state.justReturned,
    awayMinutes: 30,
    game: null,
    foreground: null,
    screen: null,
  }
}

async function advanceOneTick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(60_000)
  await vi.waitFor(() => {
    if (state.inputs.length === 0) throw new Error('尚未主动开口')
  })
}

describe('Agent 主动开口调度', () => {
  let stop: () => void

  beforeEach(async () => {
    vi.useFakeTimers()
    state.directorMode = 'life'
    state.justReturned = true
    state.inputs = []
    state.evaluateCalls = 0
    state.sending = []
    vi.stubGlobal('window', {
      opengal: {
        config: { get: async () => ({ success: true, data: { asr: asrConfig() } }) },
        env: { get: async () => ({ success: true, data: envSnapshot() }) },
      },
    })
    const { startInitiative } = await import('@/features/director/initiative')
    stop = startInitiative()
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('刚回来不能绕过静默阈值；达到阈值后仍主动开口', async () => {
    await advanceOneTick()
    expect(state.evaluateCalls).toBe(1)
    expect(state.inputs).toHaveLength(1)
    expect(state.inputs[0]?.source).toBe('system')
    expect(state.sending).toEqual([true])
  })
})
