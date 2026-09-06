import * as React from 'react'
import { Send, ChevronUp, ChevronDown, Square, ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useChatStore, type PersistedUserMessage, type PersistedAssistantMessage } from '@/features/chat/chatStore'
import { useChatPipeline } from '@/features/pipeline/useChatPipeline'
import { pipelineBus } from '@/features/pipeline'
import { getLive2DModel } from '@/features/live2d/live2dBus'
import { useASRStore, setASRFinalCallback } from '@/features/asr/asrStore'
import { offerUtterance, setDirectorDispatch } from '@/features/pipeline/directorWorker'
import { extractAssistantDisplayText } from '@shared/roleCard'
import { useCharacterStore } from '@/features/character/characterStore'
import { MicButton } from './MicButton'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import { usePendingImages, PendingImagesBar } from './imageAttachments'

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
  const streamingSegments = useChatStore((s) => s.streamingSegments)
  const send = useChatPipeline()
  const [draft, setDraft] = React.useState('')
  const pendingImages = usePendingImages()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const character = useCharacterStore((s) => s.list.find((c) => c.id === s.activeId))

  const streamingDisplay = streamingSegments.map((s) => s.item.text).join('')

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const displayText = streamingDisplay
    || (lastAssistant ? extractAssistantDisplayText(lastAssistant.content as string) : '')
  const displayName = character?.displayName ?? character?.name ?? 'OpenGal'

  React.useEffect(() => {
    if (historyOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [historyOpen, messages.length, streamingSegments.length])

  React.useEffect(() => {
    let directorEnabled = false
    let autoSend = true
    window.opengal.config.get().then((res) => {
      directorEnabled = res.data?.asr?.directorEnabled ?? false
      autoSend = res.data?.asr?.autoSend !== false
    })
    setASRFinalCallback((text) => {
      if (!text.trim()) return
      if (directorEnabled) {
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
    if ((!text && pendingImages.images.length === 0) || isSending) return
    const images = pendingImages.images
    setDraft('')
    pendingImages.clear()
    send(text, images.length > 0 ? images : undefined)
  }

  function handleStop(): void {
    abortPipeline()
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col">
      {/* 历史对话（上滑展开）。收起时必须 pointer-events-none，
          否则透明的 flex-1 容器会盖住画布，吃掉拖拽/滚轮，导致无法移动缩放人物。 */}
      <div
        className={cn(
          'flex-1 overflow-hidden transition-all duration-200',
          historyOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        {historyOpen && (
          <div ref={scrollRef} className="flex h-full flex-col gap-2 overflow-y-auto bg-background/85 p-4 backdrop-blur-sm">
            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  'flex flex-col gap-0.5',
                  message.role === 'user' ? 'items-end' : 'items-start'
                )}
              >
                <span className="text-[10px] text-muted-foreground">
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
                            className="max-h-32 max-w-full rounded-md border border-white/20 object-cover"
                          />
                        ))}
                      </div>
                    )}
                  {message.role === 'assistant'
                    ? extractAssistantDisplayText(message.content as string)
                    : (message as PersistedUserMessage).userText}
                </div>
              </div>
            ))}
            {streamingDisplay && (
              <div className="flex flex-col items-start gap-0.5">
                <span className="text-[10px] text-muted-foreground">{displayName}</span>
                <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-secondary px-3 py-1.5 text-sm text-secondary-foreground">
                  {streamingDisplay}
                </div>
              </div>
            )}
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive whitespace-pre-wrap break-all">
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setHistoryOpen((v) => !v)}
        className="pointer-events-auto absolute right-3 top-14 z-10 flex h-6 items-center gap-0.5 rounded-full border bg-background/60 px-2 text-[10px] text-muted-foreground backdrop-blur-sm"
      >
        {historyOpen ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
        {historyOpen ? '收起' : `历史 ${messages.length}`}
      </button>

      <div className="pointer-events-auto relative mx-auto mb-4 w-[calc(100%-1.5rem)] max-w-3xl rounded-2xl border bg-background/85 shadow-lg backdrop-blur-sm">
        <span className="absolute -top-3 left-4 rounded-md border bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground shadow">
          {displayName}
        </span>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="block w-full px-4 pt-3 pb-1 text-left"
        >
          <span className={cn(
            'block min-h-[2.5rem] whitespace-pre-wrap text-sm leading-relaxed',
            !displayText && !isSending && 'text-muted-foreground'
          )}>
            {displayText || (isSending ? '……' : '')}
          </span>
        </button>

        <div className="px-3 pb-3 pt-1">
          <PendingImagesBar pending={pendingImages} />
          <div className="flex items-end gap-2">
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              onPaste={pendingImages.handlePaste}
              placeholder="输入消息，可粘贴图片..."
              className="min-h-[40px] resize-none bg-muted/50 text-sm"
              rows={1}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-10 shrink-0"
              title="添加图片"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-4" />
            </Button>
            <MicButton />
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
                disabled={!draft.trim() && pendingImages.images.length === 0}
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
