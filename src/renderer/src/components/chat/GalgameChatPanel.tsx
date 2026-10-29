import * as React from 'react'
import { Send, Square, ImagePlus, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useChatStore, type PersistedUserMessage } from '@/features/chat/chatStore'
import { useChatPipeline } from '@/features/pipeline/useChatPipeline'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import { getLive2DModel } from '@/features/live2d/live2dBus'
import { useASRStore, setASRFinalCallback } from '@/features/asr/asrStore'
import { offerUtterance, setDirectorDispatch } from '@/features/pipeline/directorWorker'
import { extractAssistantDisplayText } from '@shared/roleCard'
import { isCharacterRunning } from '@shared/characterRuntime'
import { useCharacterRuntimeStore } from '@/features/character/characterRuntimeStore'
import { useCharacterStore } from '@/features/character/characterStore'
import { useStartupStore } from '@/features/startup/startupStore'
import { displaySubtitle, useSubtitleStore } from '@/features/pipeline/subtitles'
import { consumeVoiceInterruption } from '@/features/pipeline/bargeIn'
import { MicButton } from './MicButton'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import { usePendingImages, PendingImagesBar } from './imageAttachments'

const COMPOSITION_GUARD_MS = 500
const BOTTOM_STICK_PX = 40
const BOTTOM_JUMP_PX = 120

function abortPipeline(): void {
  pipelineBus.emit('pipeline:abort', undefined)
  const model = getLive2DModel()
  if (model) {
    try { model.stopSpeaking() } catch { /* ignore */ }
  }
}

export function GalgameChatPanel() {
  const messages = useChatStore((s) => s.messages)
  const isSending = useChatStore((s) => s.isSending)
  const error = useChatStore((s) => s.error)
  const persistError = useChatStore((s) => s.persistError)
  const streamingSegments = useChatStore((s) => s.streamingSegments)
  const send = useChatPipeline()
  const [draft, setDraft] = React.useState('')
  const pendingImages = usePendingImages()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [showJump, setShowJump] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const stickRef = React.useRef(true)
  const composingRef = React.useRef(false)
  const compositionEndAtRef = React.useRef(0)
  const character = useCharacterStore((s) => s.list.find((c) => c.id === s.activeId))
  const bootAwake = useStartupStore((s) => s.phase === 'awake')
  const runningById = useCharacterRuntimeStore((s) => s.byId)
  const sleeping = Boolean(character && !isCharacterRunning(runningById, character.id))
  const canInteract = bootAwake && !sleeping
  useSubtitleStore((s) => s.records)
  useSubtitleStore((s) => s.preferences)
  const subtitle = (text: string): string => displaySubtitle(character?.id ?? '', text)

  const streamingDisplay = streamingSegments.map((s) => s.item.text).join('')
  const displayName = character?.displayName ?? character?.name ?? 'OpenGal'

  const scrollToLatest = React.useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = true
    setShowJump(false)
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickRef.current = distance <= BOTTOM_STICK_PX
    setShowJump(distance > BOTTOM_JUMP_PX)
  }, [])

  // 流式输出期间内容高度一直在变，所以每次渲染后按「是否贴底」决定要不要跟随
  React.useLayoutEffect(() => {
    if (!stickRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  })

  React.useEffect(() => {
    setASRFinalCallback((text) => {
      if (!text.trim()) return
      const settings = useASRStore.getState().settings
      const directorEnabled = settings?.directorEnabled ?? false
      const autoSend = settings?.autoSend !== false
      const interrupted = consumeVoiceInterruption()
      if (directorEnabled && !interrupted) {
        offerUtterance(text)
        return
      }
      if (autoSend) {
        send(text.trim())
      } else {
        setDraft((prev) => (prev ? prev + ' ' : '') + text.trim())
      }
    })
    setDirectorDispatch((input) => send(input.text))
    return () => {
      setASRFinalCallback(null)
      setDirectorDispatch(null)
    }
  }, [send])

  function handleSend(): void {
    const text = draft.trim()
    if ((!text && pendingImages.images.length === 0) || isSending || sleeping) return
    const images = pendingImages.images.map((image) => image.url)
    stickRef.current = true
    setDraft('')
    pendingImages.clear()
    send(text, images.length > 0 ? images : undefined)
  }

  function handleStop(): void {
    abortPipeline()
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
        <span className="truncate text-xs font-medium">{displayName}</span>
        <span className="text-xs text-muted-foreground">{sleeping ? '沉睡中' : '运行中'}</span>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex h-full flex-col gap-2 overflow-y-auto p-4"
        >
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                'flex flex-col gap-0.5',
                message.role === 'user' ? 'items-end' : 'items-start'
              )}
            >
              <span className="text-xs text-muted-foreground">
                {message.role === 'user' ? '我' : displayName}
              </span>
              <div
                className={cn(
                  'max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-1.5 text-sm',
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground'
                )}
              >
                {message.role === 'user' &&
                  (message as PersistedUserMessage).images &&
                  (message as PersistedUserMessage).images!.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {(message as PersistedUserMessage).images!.map((url, i) => (
                        <img
                          key={i}
                          src={url}
                          alt={`图片 ${i + 1}`}
                          className="max-h-32 max-w-full rounded-md object-cover"
                        />
                      ))}
                    </div>
                  )}
                {message.role === 'assistant'
                  ? subtitle(extractAssistantDisplayText(message.content as string))
                  : (message as PersistedUserMessage).userText}
              </div>
            </div>
          ))}

          {streamingDisplay && (
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-xs text-muted-foreground">{displayName}</span>
              <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-secondary px-3 py-1.5 text-sm text-secondary-foreground">
                {subtitle(streamingDisplay)}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive whitespace-pre-wrap break-all">
              {error}
            </div>
          )}
          {persistError && (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive whitespace-pre-wrap break-all">
              聊天记录未保存：{persistError}
            </div>
          )}
        </div>

        {showJump && (
          <button
            type="button"
            onClick={() => scrollToLatest(true)}
            className="edge absolute bottom-3 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1 rounded-full bg-background/95 px-3 text-xs text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground"
          >
            <ArrowDown className="size-3" />
            跳至最新
          </button>
        )}
      </div>

      <div className="shrink-0 px-3 pb-3 pt-1">
        <PendingImagesBar pending={pendingImages} />
        <div className="rounded-xl bg-card/70 p-2">
          <div className="flex items-end gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                pendingImages.handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
                compositionEndAtRef.current = performance.now()
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey) return
                const native = e.nativeEvent
                // 选字中的回车属于输入法，既不发送也不 preventDefault，否则会打断候选确认
                if (composingRef.current || native.isComposing || native.keyCode === 229) return
                // 选字结束 500ms 内的回车只可能是选词确认的伴生键，吞掉换行但不发送
                if (performance.now() - compositionEndAtRef.current < COMPOSITION_GUARD_MS) {
                  e.preventDefault()
                  return
                }
                e.preventDefault()
                handleSend()
              }}
              onPaste={pendingImages.handlePaste}
              placeholder={sleeping ? '她正在沉睡，点击左侧头像唤醒' : canInteract ? '输入消息，可粘贴图片...' : '正在唤醒…'}
              disabled={!canInteract}
              className="max-h-60 min-h-11 resize-none overflow-y-auto rounded-md bg-background text-sm leading-relaxed [field-sizing:content]"
              rows={1}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-10 shrink-0"
              title="添加图片"
              disabled={!canInteract}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-4" />
            </Button>
            <div className={cn(!canInteract && 'pointer-events-none opacity-40')}>
              <MicButton />
            </div>
            <ContextUsageIndicator />
            {isSending ? (
              <Button
                size="icon"
                className="size-10 shrink-0"
                onClick={handleStop}
                title="停止"
              >
                <Square className="size-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="size-10 shrink-0"
                onClick={handleSend}
                disabled={(!draft.trim() && pendingImages.images.length === 0) || !canInteract}
                title="发送"
              >
                <Send className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
