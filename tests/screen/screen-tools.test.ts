import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCREEN_FALLBACK_MARKER, SCREEN_FRAME_MARKER } from '../../src/shared/screen'

let activePng = Buffer.from('screen2-png')
const idlePng = Buffer.from('fake-png-data')

const fakeSources = [
  {
    id: 'screen:0:0',
    name: 'Screen 1',
    display_id: '1001',
    thumbnail: { toPNG: () => idlePng },
  },
  {
    id: 'screen:1:0',
    name: 'Screen 2',
    display_id: '2002',
    thumbnail: { toPNG: () => activePng },
  },
]

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  desktopCapturer: {
    getSources: vi.fn(async () => fakeSources),
  },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 1950, y: 100 })),
    getDisplayNearestPoint: vi.fn(() => ({ id: 2002 })),
  },
}))

vi.mock('../../src/main/services/screenWatch', () => ({
  isScreenWatchEnabled: vi.fn(() => false),
  lookAtScreen: vi.fn(async () => null),
}))

vi.mock('../../src/main/services/configStore', () => ({
  readConfig: vi.fn(() => ({
    tools: { fileSearchDirs: [] },
    screen: { watch: false, excludeSelf: true },
  })),
}))

vi.mock('../../src/main/services/memory', () => ({
  getMemoryBlock: vi.fn(),
  recallVerbatim: vi.fn(),
}))

vi.mock('../../src/main/services/logBus', () => ({
  logBus: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { handleScreenshot, handleLookScreen } from '../../src/main/services/tools/builtin'

let nowMs = 1_000_000

beforeEach(() => {
  vi.clearAllMocks()
  activePng = Buffer.from('screen2-png')
  nowMs += 10_000
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('screen tools', () => {
  it('handleScreenshot 优先命中光标所在的活动显示器', async () => {
    const res = await handleScreenshot()
    expect(res.startsWith(SCREEN_FRAME_MARKER)).toBe(true)
    expect(res).toContain(activePng.toString('base64'))
    expect(res).not.toContain(idlePng.toString('base64'))
  })

  it('handleLookScreen 拿不到回放时退回此刻一帧，并标明只有一帧', async () => {
    const res = await handleLookScreen(10)
    expect(res.startsWith(SCREEN_FALLBACK_MARKER)).toBe(true)
  })

  it('冷却期过后的第二次调用重新拍摄，不返回上一张', async () => {
    const first = await handleScreenshot()
    activePng = Buffer.from('screen2-png-v2')
    nowMs += 4_000
    const second = await handleScreenshot()
    expect(second).toContain(activePng.toString('base64'))
    expect(second).not.toBe(first)
  })
})
