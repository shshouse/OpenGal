import * as React from 'react'
import type { SpriteFrames } from '@shared/types'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import { useStartupStore } from '@/features/startup/startupStore'
import './sprite.css'

export function SpriteStage({ frames, characterId, sleeping, pet = false }: {
  frames: SpriteFrames
  characterId: string
  sleeping: boolean
  pet?: boolean
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
    const offPet = pet ? window.opengal.pet.onPerformance((event) => {
      if (event.emotion && (!event.characterId || event.characterId === characterId)) setEmotion(event.emotion)
      if (event.speaking !== undefined && (!event.characterId || event.characterId === characterId)) {
        setSpeaking(event.speaking)
      }
    }) : () => {}
    return () => { off(); offEmotion(); offPet() }
  }, [characterId, pet])

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
  return <div className="flex h-full w-full items-end justify-center overflow-hidden" style={{ background: pet ? 'transparent' : undefined }}>
    <img src={src} alt="角色立绘" draggable={false} className={`h-full max-w-full object-contain object-bottom ${sleeping ? '' : 'sprite-breathe'}`} style={{ filter: sleeping ? 'saturate(0.55) brightness(0.7)' : undefined }}
      onLoad={() => { if (!pet) useStartupStore.getState().reportLive2d('ok') }}
      onError={() => { if (!pet) useStartupStore.getState().reportLive2d('failed', '立绘加载失败') }} />
  </div>
}
