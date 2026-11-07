// 采集页：持有一条常驻的桌面视频流，按需算变化分、拼图。
// 只在隐藏窗口里运行，不参与界面；对主进程只暴露 globalThis 上的几个函数。

import {
  CHANGE_FLOOR,
  SCAN_H,
  SCAN_W,
  hsvDiffScore,
  pickKeyframes,
  toHsv,
  type SampledFrame,
  type ScreenPulse,
} from '@shared/screen'

const SHEET_W = 798
const SHEET_H = 450
const TILE_W = SHEET_W / 2
const TILE_H = SHEET_H / 2
const PEAK_WINDOW_MS = 60_000
const SAMPLE_GAP_MS = 320
/** 拼图时最多同时留着的候选位图，超出按分数淘汰 */
const CANDIDATE_KEEP = 8

interface Sample extends SampledFrame {
  index: number
}

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let scanCtx: CanvasRenderingContext2D | null = null
let frameCanvas: HTMLCanvasElement | null = null
let frameCtx: CanvasRenderingContext2D | null = null
let sheetCanvas: HTMLCanvasElement | null = null
let sheetCtx: CanvasRenderingContext2D | null = null

let prevHsv: Uint8Array | null = null
let lastScore = 0
let lastChangedAt = 0
let pulseHistory: Array<{ at: number; score: number }> = []

let looking = false
let samples: Sample[] = []
const bitmaps = new Map<number, ImageBitmap>()
let latestIndex = -1

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('采集画布不可用')
  return ctx
}

async function start(sourceId: string): Promise<{ width: number; height: number }> {
  stop()
  // 桌面源走 Chromium 的私有约束，标准 MediaTrackConstraints 里没有这几项
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: SHEET_W,
        maxHeight: SHEET_H,
        maxFrameRate: 5,
      },
    },
  } as unknown as MediaStreamConstraints
  stream = await navigator.mediaDevices.getUserMedia(constraints)
  const element = document.createElement('video')
  element.srcObject = stream
  element.muted = true
  await element.play()
  await new Promise<void>((resolve, reject) => {
    if (element.readyState >= 2) {
      resolve()
      return
    }
    element.addEventListener('loadeddata', () => resolve(), { once: true })
    setTimeout(() => reject(new Error('采集流没有出帧')), 5000)
  })
  video = element

  const scan = document.createElement('canvas')
  scan.width = SCAN_W
  scan.height = SCAN_H
  scanCtx = context2d(scan)

  frameCanvas = document.createElement('canvas')
  frameCanvas.width = SHEET_W
  frameCanvas.height = SHEET_H
  frameCtx = context2d(frameCanvas)

  sheetCanvas = document.createElement('canvas')
  sheetCanvas.width = SHEET_W
  sheetCanvas.height = SHEET_H
  sheetCtx = context2d(sheetCanvas)

  prevHsv = null
  lastScore = 0
  lastChangedAt = Date.now()
  pulseHistory = []
  return { width: element.videoWidth, height: element.videoHeight }
}

function stop(): void {
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  video = null
  scanCtx = null
  frameCtx = null
  sheetCtx = null
  prevHsv = null
  releaseBitmaps()
}

function releaseBitmaps(): void {
  for (const bitmap of bitmaps.values()) bitmap.close()
  bitmaps.clear()
  samples = []
  latestIndex = -1
}

/** 读当前帧并打分，同时推进变化时间。 */
function readScore(): number {
  if (!video || !scanCtx) return 0
  scanCtx.drawImage(video, 0, 0, SCAN_W, SCAN_H)
  const hsv = toHsv(scanCtx.getImageData(0, 0, SCAN_W, SCAN_H).data)
  const score = prevHsv ? hsvDiffScore(prevHsv, hsv) : 0
  prevHsv = hsv
  lastScore = score
  const now = Date.now()
  if (score >= CHANGE_FLOOR) lastChangedAt = now
  pulseHistory.push({ at: now, score })
  pulseHistory = pulseHistory.filter((item) => now - item.at <= PEAK_WINDOW_MS)
  return score
}

function pulse(): ScreenPulse {
  if (looking) {
    return { score: lastScore, peakScore: lastScore, changedAt: lastChangedAt, sampledAt: Date.now() }
  }
  readScore()
  const peakScore = pulseHistory.reduce((max, item) => (item.score > max ? item.score : max), 0)
  return { score: lastScore, peakScore, changedAt: lastChangedAt, sampledAt: Date.now() }
}

function evictOverflow(): void {
  while (bitmaps.size > CANDIDATE_KEEP) {
    const victim = [...bitmaps.keys()]
      .filter((index) => index !== latestIndex)
      .sort((a, b) => (samples[a]?.score ?? 0) - (samples[b]?.score ?? 0))[0]
    if (victim === undefined) return
    bitmaps.get(victim)?.close()
    bitmaps.delete(victim)
  }
}

/** 看一眼：抓 ms 毫秒，挑出关键时刻拼成一张图。 */
async function sheet(ms: number): Promise<{
  png: string
  frames: SampledFrame[]
  width: number
  height: number
}> {
  if (looking) throw new Error('正在看屏幕，请稍后再试')
  looking = true
  releaseBitmaps()
  try {
    const started = Date.now()
    let index = 0
    while (Date.now() - started < ms) {
      const score = readScore()
      const sample: Sample = { index, at: Date.now() - started, score }
      samples.push(sample)
      if (frameCanvas && frameCtx) {
        frameCtx.drawImage(video!, 0, 0, SHEET_W, SHEET_H)
        bitmaps.set(index, await createImageBitmap(frameCanvas))
        latestIndex = index
        evictOverflow()
      }
      index += 1
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_GAP_MS))
    }

    const chosen = pickKeyframes(samples, 4, 800)
    const frames = chosen
      .map((index) => samples[index])
      .filter((sample): sample is Sample => sample !== undefined)
    return { png: compose(chosen), frames, width: SHEET_W, height: SHEET_H }
  } finally {
    releaseBitmaps()
    looking = false
  }
}

function compose(chosen: readonly number[]): string {
  if (!sheetCtx || !sheetCanvas) throw new Error('拼图画布不可用')
  sheetCtx.fillStyle = '#0b0b0c'
  sheetCtx.fillRect(0, 0, SHEET_W, SHEET_H)
  const cells: Array<[number, number, number, number]> = chosen.length <= 1
    ? [[0, 0, SHEET_W, SHEET_H]]
    : [
        [0, 0, TILE_W, TILE_H],
        [TILE_W, 0, TILE_W, TILE_H],
        [0, TILE_H, TILE_W, TILE_H],
        [TILE_W, TILE_H, TILE_W, TILE_H],
      ]
  chosen.forEach((index, order) => {
    const cell = cells[order]
    const bitmap = bitmaps.get(index)
    if (!cell || !bitmap) return
    const [x, y, w, h] = cell
    sheetCtx!.drawImage(bitmap, x, y, w, h)
  })
  if (chosen.length > 1) {
    sheetCtx.font = '500 16px system-ui, sans-serif'
    sheetCtx.textBaseline = 'top'
    chosen.forEach((index, order) => {
      const cell = cells[order]
      if (!cell) return
      const [x, y] = cell
      sheetCtx!.fillStyle = 'rgba(0,0,0,0.55)'
      sheetCtx!.fillRect(x + 6, y + 6, 22, 22)
      sheetCtx!.fillStyle = '#ffffff'
      sheetCtx!.fillText(String(order + 1), x + 13, y + 8)
    })
  }
  return sheetCanvas.toDataURL('image/png')
}

Object.assign(globalThis, {
  __screenStart: start,
  __screenStop: stop,
  __screenPulse: pulse,
  __screenSheet: sheet,
})
