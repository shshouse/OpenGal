import * as React from 'react'
import { Send, Square, ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/features/chat/chatStore'
import { useChatPipeline } from '@/features/pipeline/useChatPipeline'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import { getLive2DModel } from '@/features/live2d/live2dBus'
import { useASRStore, setASRFinalCallback } from '@/features/asr/asrStore'
import { offerUtterance, setDirectorDispatch } from '@/features/pipeline/directorWorker'
import { extractAssistantDisplayText } from '@shared/roleCard'
import { isRoleRunning } from '@shared/roleRuntime'
import { useRoleRuntimeStore } from '@/features/role/roleRuntimeStore'
import { useRoleStore } from '@/features/role/roleStore'
import { useStartupStore } from '@/features/startup/startupStore'
import { displaySubtitle, useSubtitleStore } from '@/features/pipeline/subtitles'
import { consumeVoiceInterruption } from '@/features/pipeline/bargeIn'
import { MicButton } from './MicButton'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import { usePendingImages, PendingImagesBar } from './imageAttachments'

const COMPOSITION_GUARD_MS = 500

// 先按空行分段；整段没有空行时按中文句末标点断句，英文句点不切，避免误伤小数和缩写
function splitReply(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const paragraphs = trimmed.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  if (paragraphs.length > 1) return paragraphs
  const sentences = trimmed.split(/(?<=[。！？…])\s*|\n+/).map((part) => part.trim()).filter(Boolean)
  return sentences.length > 1 ? sentences : [trimmed]
}

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
  const composingRef = React.useRef(false)
  const compositionEndAtRef = React.useRef(0)
  const role = useRoleStore((s) => s.list.find((c) => c.id === s.activeId))
  const bootAwake = useStartupStore((s) => s.phase === 'awake')
  const runningById = useRoleRuntimeStore((s) => s.byId)
  const sleeping = Boolean(role && !isRoleRunning(runningById, role.id))
  const canInteract = bootAwake && !sleeping
  useSubtitleStore((s) => s.records)
  useSubtitleStore((s) => s.preferences)
  const subtitle = (text: string): string => displaySubtitle(role?.id ?? '', text)

  const streamingDisplay = streamingSegments.map((s) => s.item.text).join('')
  const [cursor, setCursor] = React.useState(0)
  const replyRef = React.useRef<HTMLDivElement>(null)

  function latestReply(): string {
    const last = [...messages].reverse().find((message) => message.role === 'assistant')
    return last ? subtitle(extractAssistantDisplayText(last.content as string)) : ''
  }

  const reply = streamingDisplay ? subtitle(streamingDisplay) : latestReply()
  const segments = React.useMemo(() => splitReply(reply), [reply])
  const visible = streamingDisplay ? reply : (segments[cursor] ?? '')
  const hasMore = !streamingDisplay && cursor < segments.length - 1

  React.useEffect(() => {
    setCursor(0)
  }, [messages.length, reply])

  // 流式输出时跟在最新一行，分段阅读时高度不够也能看到末尾
  React.useEffect(() => {
    const el = replyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visible])

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
    setDirectorDispatch((input) => send(input.text, undefined, input.systemPrompt))
    return () => {
      setASRFinalCallback(null)
      setDirectorDispatch(null)
    }
  }, [send])

  function handleSend(): void {
    const text = draft.trim()
    if ((!text && pendingImages.images.length === 0) || isSending || sleeping) return
    const images = pendingImages.images.map((image) => image.url)
    setDraft('')
    pendingImages.clear()
    send(text, images.length > 0 ? images : undefined)
  }

  return (
    <div className="pointer-events-none flex h-full flex-col justify-end">
      <div className="pointer-events-auto mx-auto w-full max-w-3xl px-6 pb-6">
        {visible ? (
          <div className="mb-5">
            <div ref={replyRef} className="max-h-[42vh] overflow-y-auto">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground [text-shadow:0_1px_3px_hsl(var(--background))]">
                {visible}
              </p>
            </div>
            {hasMore ? (
              <button
                type="button"
                onClick={() => setCursor((value) => Math.min(value + 1, segments.length - 1))}
                className="mt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                继续
              </button>
            ) : null}
          </div>
        ) : null}

        {(error || persistError) && (
          <div className="mb-2 rounded-md bg-destructive/15 px-3 py-1.5 text-xs text-destructive">
            {error || `聊天记录未保存：${persistError}`}
          </div>
        )}

        <PendingImagesBar pending={pendingImages} />

        <div className="rounded-xl border bg-card p-2 shadow-lg shadow-black/25">
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
            placeholder={sleeping ? '她正在沉睡，点击顶栏头像唤醒' : canInteract ? '输入消息，可粘贴图片…' : '正在唤醒…'}
            disabled={!canInteract}
            className="max-h-52 min-h-10 resize-none border-0 bg-transparent px-2 py-1.5 text-sm leading-relaxed shadow-none focus-visible:ring-0 [field-sizing:content]"
            rows={1}
          />

          <div className="mt-1 flex items-center gap-0.5">
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
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              title="添加图片"
              disabled={!canInteract}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-4" />
            </Button>
            <div className={cn(!canInteract && 'pointer-events-none opacity-40')}>
              <MicButton />
            </div>

            <div className="ml-auto flex items-center gap-1">
              <ContextUsageIndicator />
              {isSending ? (
                <Button size="icon" className="size-8 shrink-0" onClick={abortPipeline} title="停止">
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={handleSend}
                  disabled={(!draft.trim() && pendingImages.images.length === 0) || !canInteract}
                  title="发送"
                >
                  <Send className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
