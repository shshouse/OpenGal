import * as React from 'react'
import { Send, Eraser, Square, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useChatStore, type RagAttachment, type PersistedUserMessage, type PersistedAssistantMessage } from '@/features/chat/chatStore'
import { useChatPipeline } from '@/features/pipeline/useChatPipeline'
import { pipelineBus } from '@/features/pipeline'
import { getLive2DModel } from '@/features/live2d/live2dBus'
import { extractAssistantDisplayText } from '@shared/roleCard'
import { useASRStore, setASRFinalCallback } from '@/features/asr/asrStore'
import { MicButton } from './MicButton'
import { BusyBar } from './BusyBar'
import { ToolCallList } from './ToolCallList'
import { AttachmentList } from './AttachmentList'

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
  const [ragFiles, setRagFiles] = React.useState<string[]>([])
  const [ragOpen, setRagOpen] = React.useState(false)
  const [attached, setAttached] = React.useState<Record<string, string>>({})
  const viewportRef = React.useRef<HTMLDivElement>(null)

  function handleRagOpen(open: boolean): void {
    setRagOpen(open)
    if (open) {
      void window.opengal.rag.listFiles().then((res) => {
        if (res.success && res.data) setRagFiles(res.data)
      })
    }
  }

  async function handleRagFileClick(fileName: string): Promise<void> {
    if (attached[fileName]) {
      const { [fileName]: _removed, ...rest } = attached
      void _removed
      setAttached(rest)
      return
    }
    const res = await window.opengal.rag.readFile(fileName)
    if (!res.success || !res.data) return
    setAttached((prev) => ({ ...prev, [fileName]: res.data! }))
  }

  function removeAttachment(fileName: string): void {
    setAttached((prev) => {
      const { [fileName]: _removed, ...rest } = prev
      void _removed
      return rest
    })
  }

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
    const attachments: RagAttachment[] = Object.entries(attached).map(([fileName, content]) => ({
      fileName,
      content
    }))
    setDraft('')
    setAttached({})
    send(userText, attachments.length > 0 ? attachments : undefined)
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
  const hasAttached = Object.keys(attached).length > 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Neuro</h2>
          <p className="text-xs text-muted-foreground">对话回复会同步推送到桌宠气泡</p>
        </div>
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

      <ScrollArea className="flex-1">
        <div ref={viewportRef} className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
          {messages.length === 0 && !streamingDisplay ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              输入消息开始对话。点击输入框左侧文件图标选择 data/ 下的 .txt 文件作为知识库引用。
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
                {message.role === 'user' && (message as PersistedUserMessage).attachments && (message as PersistedUserMessage).attachments!.length > 0 && (
                  <AttachmentList attachments={(message as PersistedUserMessage).attachments!} align="right" />
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
          {hasAttached && (
            <div className="flex flex-wrap items-center gap-1.5">
              {Object.keys(attached).map((fileName) => (
                <button
                  key={fileName}
                  type="button"
                  onClick={() => removeAttachment(fileName)}
                  className="flex items-center gap-1 rounded-full border bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-destructive/15 hover:text-destructive hover:border-destructive/40 active:scale-[0.96] transition-all duration-150"
                  title="移除此文件"
                >
                  <FileText className="size-3" />
                  <span className="font-mono">{fileName}</span>
                  <X className="size-3" />
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={asrPartial || draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasAttached ? '只写你的问题（引用文件已附加）' : 'Shift + Enter 换行，Enter 发送'}
              className="min-h-[44px] resize-none"
              rows={2}
              readOnly={!!asrPartial}
            />
            <MicButton />
            <Popover open={ragOpen} onOpenChange={handleRagOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant={hasAttached ? 'default' : 'ghost'}
                  size="icon"
                  className="size-9"
                  title="选择 data/ 下的 .txt 文件作为知识库引用"
                >
                  <FileText className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-1">
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  选文件作为知识库引用（点第二次取消）
                </div>
                {ragFiles.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">data/ 下无 .txt 文件</div>
                ) : (
                  ragFiles.map((f) => {
                    const selected = !!attached[f]
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => void handleRagFileClick(f)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left transition-all duration-150',
                          selected
                            ? 'bg-primary/90 text-primary-foreground'
                            : 'hover:bg-accent active:scale-[0.98]'
                        )}
                      >
                        <FileText className="size-3.5 shrink-0" />
                        <span className="font-mono">{f}</span>
                        {selected && <span className="ml-auto text-[10px]">已选</span>}
                      </button>
                    )
                  })
                )}
              </PopoverContent>
            </Popover>
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
