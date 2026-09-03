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
