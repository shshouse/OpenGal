/** 屏幕采样的公共约定：采集页用这套算分，主进程和提示词用同一套读数。 */

/** 工具结果里带这个前缀，说明后面是一张图，渲染层要转成图片消息 */
export const SCREEN_FRAME_MARKER = 'OPENGAL_SCREENSHOT:'
export const SCREEN_SHEET_MARKER = 'OPENGAL_SCREEN_SHEET:'
/** 想要回放却只拍到此刻一帧时用：模型据此知道不能描述这段时间发生过什么 */
export const SCREEN_FALLBACK_MARKER = 'OPENGAL_SCREEN_FALLBACK:'

export const SCAN_W = 64
export const SCAN_H = 36

/** 明显换了画面（切窗口、换页面）；低于它只算有动静，不算换了一张。 */
export const CHANGE_STRONG = 25
/** 有动静的门槛，用来区分"完全静止"和"光标在动"。 */
export const CHANGE_FLOOR = 8

export interface ScreenPulse {
  /** 最近一次采样的变化分，0–255 */
  score: number
  /** 最近一分钟里的最高分 */
  peakScore: number
  /** 画面最后一次明显变化的时间戳；从未变化时为 0 */
  changedAt: number
  sampledAt: number
}

export interface SampledFrame {
  at: number
  score: number
}

function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  if (delta === 0) return 0
  const raw = max === r
    ? ((g - b) / delta) % 6
    : max === g
      ? (b - r) / delta + 2
      : (r - g) / delta + 4
  const hue = raw * 60
  return hue < 0 ? hue + 360 : hue
}

/** RGBA 像素转 HSV，各通道归一到 0–255，只为算差，不追求色彩准确。 */
export function toHsv(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const pixels = Math.floor(rgba.length / 4)
  const out = new Uint8Array(pixels * 3)
  for (let i = 0, j = 0; j < out.length; i += 4, j += 3) {
    const r = (rgba[i] ?? 0) / 255
    const g = (rgba[i + 1] ?? 0) / 255
    const b = (rgba[i + 2] ?? 0) / 255
    const max = Math.max(r, g, b)
    const delta = max - Math.min(r, g, b)
    out[j] = (hueOf(r, g, b) / 360) * 255
    out[j + 1] = max === 0 ? 0 : (delta / max) * 255
    out[j + 2] = max * 255
  }
  return out
}

/**
 * 两帧的加权绝对差，0–255。
 * 色相按环形处理，低饱和像素的色相降权——灰底上换文字不会被误判成换了画面。
 */
export function hsvDiffScore(prev: Uint8Array, cur: Uint8Array): number {
  if (prev.length !== cur.length || cur.length === 0) return 0
  let sum = 0
  for (let i = 0; i < cur.length; i += 3) {
    const prevH = prev[i] ?? 0
    const prevS = prev[i + 1] ?? 0
    const prevV = prev[i + 2] ?? 0
    const curH = cur[i] ?? 0
    const curS = cur[i + 1] ?? 0
    const curV = cur[i + 2] ?? 0
    const dh = Math.abs(curH - prevH)
    const hue = dh < 255 - dh ? dh : 255 - dh
    const weight = (curS < prevS ? curS : prevS) / 255
    sum += hue * weight + Math.abs(curS - prevS) + Math.abs(curV - prevV)
  }
  return sum / cur.length
}

/**
 * 从一段采样里挑出要拼进图的帧。
 *
 * 最后一帧必留（那是用户此刻的屏幕）。其余按分数从高到低取，彼此至少隔 minGapMs，
 * 低于 CHANGE_FLOOR 的一律不要——画面没动的时候，一张图就够了。
 */
function isSpacedApart(
  frames: readonly SampledFrame[],
  kept: Set<number>,
  at: number,
  minGapMs: number,
): boolean {
  for (const index of kept) {
    if (Math.abs(at - (frames[index]?.at ?? 0)) < minGapMs) return false
  }
  return true
}

export function pickKeyframes(
  frames: readonly SampledFrame[],
  max = 4,
  minGapMs = 800,
): number[] {
  if (frames.length === 0) return []
  const last = frames.length - 1
  const kept = new Set<number>([last])
  const ranked = frames
    .map((frame, index) => ({ index, score: frame.score }))
    .filter((item) => item.index !== last)
    .sort((a, b) => b.score - a.score)

  for (const item of ranked) {
    if (kept.size >= max) break
    if (item.score < CHANGE_FLOOR) break
    const at = frames[item.index]?.at ?? 0
    if (isSpacedApart(frames, kept, at, minGapMs)) kept.add(item.index)
  }
  return [...kept].sort((a, b) => a - b)
}
