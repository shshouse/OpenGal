import * as React from 'react'
import type { SpriteFrames } from '@shared/types'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import { useStartupStore } from '@/features/startup/startupStore'
import './sprite.css'

export function SpriteStage({ frames, characterId, sleeping, mate = false }: {
  frames: SpriteFrames
  characterId: string
  sleeping: boolean
  mate?: boolean
}) {
  const [blink, setBlink] = React.useState(false)
  const [speaking, setSpeaking] = React.useState(false)
  const [mouth, setMouth] = React.useState(false)
  const [emotion, setEmotion] = React.useState('')

  React.useEffect(() => {
    setSpeaking(false)
    setEmotion('')
    const off = pipelineBus.on('tts:playback', (event) => {
      if (!event.characterId || event.characterId === characterId) setSpeaking(event.speaking)
    })
    const offEmotion = pipelineBus.on('tts:segmentStart', (event) => {
      if (!event.characterId || event.characterId === characterId) setEmotion(event.emotion ?? '')
    })
    const offMate = mate ? window.opengal.mate.onUpdate((payload) => {
      if (payload.type !== 'performance') return
      if (payload.emotion && (!payload.characterId || payload.characterId === characterId)) setEmotion(payload.emotion)
      if (payload.speaking !== undefined && (!payload.characterId || payload.characterId === characterId)) {
        setSpeaking(payload.speaking)
      }
    }) : () => {}
    return () => { off(); offEmotion(); offMate() }
  }, [characterId, mate])

  React.useEffect(() => {
    if (sleeping) { setBlink(true); setSpeaking(false); return }
    setBlink(false)
    let next = 0
    let open = 0
    const schedule = () => {
      next = window.setTimeout(() => {
        setBlink(true)
        open = window.setTimeout(() => { setBlink(false); schedule() }, 150)
      }, 3000 + Math.random() * 3000)
    }
    schedule()
    return () => { window.clearTimeout(next); window.clearTimeout(open) }
  }, [sleeping, characterId])

  React.useEffect(() => {
    if (!speaking || sleeping) { setMouth(false); return }
    setMouth(true)
    const timer = window.setInterval(() => setMouth((value) => !value), 180)
    return () => window.clearInterval(timer)
  }, [speaking, sleeping])

  const src = blink && mouth ? frames.blinkTalk ?? frames.blink ?? frames.idle
    : blink ? frames.blink ?? frames.idle
      : mouth ? frames.talk ?? frames.idle
        : ['happy', 'excited', 'relaxed'].includes(emotion) ? frames.happy ?? frames.idle
          : ['sad', 'worried'].includes(emotion) ? frames.sad ?? frames.idle : frames.idle
  return <div className="flex h-full w-full items-end justify-center overflow-hidden" style={{ background: mate ? 'transparent' : undefined }}>
    <img src={src} alt="角色立绘" draggable={false} className={`h-full max-w-full object-contain object-bottom ${sleeping ? '' : 'sprite-breathe'}`} style={{ filter: sleeping ? 'saturate(0.55) brightness(0.7)' : undefined }}
      onLoad={() => { if (!mate) useStartupStore.getState().reportLive2d('ok') }}
      onError={() => { if (!mate) useStartupStore.getState().reportLive2d('failed', '立绘加载失败') }} />
  </div>
}
