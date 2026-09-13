export const TTS_DEFAULT_PORT = 39880

let shift: { from: number; to: number } | null = null

export function parseTtsPort(url: string): number {
  try {
    return Number(new URL(url).port) || TTS_DEFAULT_PORT
  } catch {
    return TTS_DEFAULT_PORT
  }
}

export function setTtsPortShift(from: number, to: number): void {
  shift = { from, to }
}

export function clearTtsPortShift(): void {
  shift = null
}

export function getTtsPortShift(): { from: number; to: number } | null {
  return shift
}

export function applyTtsPortShift(url: string): string {
  if (!shift) return url
  try {
    const u = new URL(url)
    if ((Number(u.port) || TTS_DEFAULT_PORT) === shift.from) {
      u.port = String(shift.to)
      return u.toString().replace(/\/+$/, '')
    }
  } catch {}
  return url
}

export function assertLocalBaseURL(url: string): void {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`TTS 服务地址格式无效: ${url}`)
  }
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
    throw new Error(`TTS 服务地址仅允许本机（127.0.0.1 / localhost），当前为 ${host}，请检查是否被角色卡 voice 配置覆盖`)
  }
}
