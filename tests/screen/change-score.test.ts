import { describe, expect, it } from 'vitest'
import { CHANGE_FLOOR, hsvDiffScore, pickKeyframes, toHsv } from '../../src/shared/screen'

function rgba(width: number, height: number, rgb: [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = rgb[0]
    out[i + 1] = rgb[1]
    out[i + 2] = rgb[2]
    out[i + 3] = 255
  }
  return out
}

describe('画面变化分', () => {
  it('同一画面得分为 0', () => {
    const a = toHsv(rgba(8, 8, [40, 90, 160]))
    const b = toHsv(rgba(8, 8, [40, 90, 160]))
    expect(hsvDiffScore(a, b)).toBe(0)
  })

  it('换一种颜色得分明显偏高', () => {
    const dark = toHsv(rgba(8, 8, [20, 20, 20]))
    const bright = toHsv(rgba(8, 8, [230, 230, 230]))
    expect(hsvDiffScore(dark, bright)).toBeGreaterThan(50)
  })

  it('亮度相近但色相不同也能判出来', () => {
    const red = toHsv(rgba(8, 8, [200, 40, 40]))
    const blue = toHsv(rgba(8, 8, [40, 40, 200]))
    expect(hsvDiffScore(red, blue)).toBeGreaterThan(12)
  })

  it('尺寸不一致时按 0 处理而不是报错', () => {
    expect(hsvDiffScore(new Uint8Array(9), new Uint8Array(12))).toBe(0)
    expect(hsvDiffScore(new Uint8Array(0), new Uint8Array(0))).toBe(0)
  })
})

describe('挑选关键时刻', () => {
  it('没有采样时返回空', () => {
    expect(pickKeyframes([])).toEqual([])
  })

  it('画面全程没动时只留最后一帧', () => {
    const frames = [0, 1, 2, 3].map((i) => ({ at: i * 1000, score: 0 }))
    expect(pickKeyframes(frames)).toEqual([3])
  })

  it('最后一帧一定在结果里，即使它分数最低', () => {
    const frames = [
      { at: 0, score: 60 },
      { at: 1000, score: 55 },
      { at: 2000, score: 0 },
    ]
    expect(pickKeyframes(frames)).toContain(2)
  })

  it('按分数取，且相邻两帧至少隔 800 毫秒', () => {
    const frames = [
      { at: 0, score: 50 },
      { at: 300, score: 49 },
      { at: 1200, score: 48 },
      { at: 2400, score: 0 },
    ]
    const picked = pickKeyframes(frames)
    expect(picked).toEqual([0, 2, 3])
  })

  it('最多只给 4 帧', () => {
    const frames = Array.from({ length: 20 }, (_, i) => ({ at: i * 900, score: 40 + i }))
    expect(pickKeyframes(frames).length).toBe(4)
  })

  it('低于起判分的帧不入选', () => {
    const frames = [
      { at: 0, score: CHANGE_FLOOR - 1 },
      { at: 1000, score: CHANGE_FLOOR - 2 },
      { at: 2000, score: 0 },
    ]
    expect(pickKeyframes(frames)).toEqual([2])
  })
})
