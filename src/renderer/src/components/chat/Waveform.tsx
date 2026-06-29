import * as React from 'react'
import { getAnalyser } from '@/features/asr/micCapture'

const BAR_COUNT = 32
const BAR_GAP = 1
const BAR_WIDTH = 2
const HEIGHT = 28
const WIDTH = (BAR_WIDTH + BAR_GAP) * BAR_COUNT - BAR_GAP

export function Waveform() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const rafRef = React.useRef<number>(0)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const buf = new Uint8Array(128)

    function draw(): void {
      rafRef.current = requestAnimationFrame(draw)
      const analyser = getAnalyser()
      if (!analyser) {
        ctx.clearRect(0, 0, WIDTH, HEIGHT)
        return
      }
      analyser.getByteFrequencyData(buf)
      ctx.clearRect(0, 0, WIDTH, HEIGHT)
      const style = getComputedStyle(canvas!)
      ctx.fillStyle = style.color
      const step = Math.floor(buf.length / BAR_COUNT)
      for (let i = 0; i < BAR_COUNT; i++) {
        const v = buf[i * step] / 255
        const h = Math.max(2, v * HEIGHT)
        const x = i * (BAR_WIDTH + BAR_GAP)
        const y = (HEIGHT - h) / 2
        ctx.beginPath()
        ctx.roundRect(x, y, BAR_WIDTH, h, 1)
        ctx.fill()
      }
    }
    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      className="text-primary"
      style={{ width: WIDTH, height: HEIGHT }}
    />
  )
}
