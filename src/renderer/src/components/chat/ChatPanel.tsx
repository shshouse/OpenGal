import * as React from 'react'
import { Send, Eraser, Square, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useChatStore, type PersistedUserMessage, type PersistedAssistantMessage } from '@/features/chat/chatStore'
import { useChatPipeline } from '@/features/pipeline/useChatPipeline'
import { pipelineBus } from '@/features/pipeline'
import { getLive2DModel } from '@/features/live2d/live2dBus'
import { isMobile } from '@/lib/utils'
import { extractAssistantDisplayText } from '@shared/roleCard'
import { useASRStore, setASRFinalCallback } from '@/features/asr/asrStore'
import { MicButton } from './MicButton'
import { BusyBar } from './BusyBar'
import { ToolCallList } from './ToolCallList'

function abortPipeline(): void {
  pipelineBus.emit('pipeline:abort', undefined)
  const model = getLive2DModel()
  if (model) {
    try { model.stopSpeaking() } catch { /* ignore */ }
  }
}

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages)
  const isSending = useChatStore((s) => s.isSending)
  const error = useChatStore((s) => s.error)
  const streamingSegments = useChatStore((s) => s.streamingSegments)
  const clear = useChatStore((s) => s.clear)
  const send = useChatPipeline()
  const asrPartial = useASRStore((s) => s.partial)
  const [draft, setDraft] = React.useState('')
  const viewportRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setASRFinalCallback((text) => {
      if (!text.trim()) return
      window.opengal.config.get().then((res) => {
        if (res.data?.asr?.autoSend !== false) {
          send(text.trim())
        } else {
          setDraft((prev) => (prev ? prev + ' ' : '') + text.trim())
        }
      })
    })
    return () => setASRFinalCallback(null)
  }, [send])

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight })
  }, [messages.length, streamingSegments.length])

  function handleSend(): void {
    if (!draft.trim() || isSending) return
    const userText = draft
    setDraft('')
    send(userText)
  }

  function handleStop(): void {
    abortPipeline()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  const streamingDisplay = streamingSegments.map((s) => s.item.text).join('')

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Neuro</h2>
          <p className="text-xs text-muted-foreground">{isMobile() ? 'OpenGal' : '对话回复会同步推送到桌宠气泡'}</p>
        </div>
        <div className="flex items-center gap-1">
          {isMobile() && (
            <Button variant="ghost" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('opengal:open-settings'))}>
              <Settings className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              abortPipeline()
              clear()
            }}
            disabled={!messages.length && !streamingDisplay}
          >
            <Eraser className="size-4" /> 清空
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div ref={viewportRef} className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
          {messages.length === 0 && !streamingDisplay ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              输入消息开始对话。
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  'flex flex-col gap-1',
                  message.role === 'user' ? 'items-end' : 'items-start'
                )}
              >
                <span className="text-xs text-muted-foreground">
                  {message.role === 'user' ? '我' : 'Neuro'}
                </span>
                <div
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm shadow-sm',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground'
                  )}
                >
                  {message.role === 'assistant'
                    ? extractAssistantDisplayText(message.content)
                    : (message as PersistedUserMessage).userText}
                </div>
                {message.role === 'assistant' &&
                  (message as PersistedAssistantMessage).toolCalls &&
                  (message as PersistedAssistantMessage).toolCalls!.length > 0 && (
                    <ToolCallList records={(message as PersistedAssistantMessage).toolCalls!} />
                  )}
              </div>
            ))
          )}
          {streamingDisplay && (
            <div className="flex flex-col gap-1 items-start">
              <span className="text-xs text-muted-foreground">Neuro</span>
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm shadow-sm bg-secondary text-secondary-foreground">
                {streamingDisplay}
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-foreground/60 animate-pulse rounded-sm" />
              </div>
            </div>
          )}
          {isSending && !streamingDisplay && (
            <div className="text-xs text-muted-foreground">思考中...</div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive whitespace-pre-wrap break-all">
              {error}
            </div>
          )}
        </div>
      </ScrollArea>

      <BusyBar />

      <div className="border-t p-3">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <div className="flex items-end gap-2">
            <Textarea
              value={asrPartial || draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Shift + Enter 换行，Enter 发送"
              className="min-h-[44px] resize-none"
              rows={2}
              readOnly={!!asrPartial}
            />
            <MicButton />
            {isSending ? (
              <Button onClick={handleStop} variant="destructive">
                <Square className="size-4" /> 停止
              </Button>
            ) : (
              <Button onClick={handleSend} disabled={!draft.trim()}>
                <Send className="size-4" /> 发送
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
