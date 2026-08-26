/**
 * 移动端 Galgame 式对话组件。
 *
 * 布局：
 * - 全屏人物（Live2D 由外层 App 渲染，本组件只负责底部对话框）
 * - 底部半透明对话框：角色名 + 最后一句台词 + 输入框
 * - 点击对话框区域可展开历史对话（上滑查看更多）
 *
 * 复用 chatStore + pipeline，与桌面端 ChatPanel 同源。
 */

import * as React from 'react'
import { Send, ChevronUp, ChevronDown, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useChatStore, type PersistedUserMessage, type PersistedAssistantMessage } from '@/features/chat/chatStore'
import { useChatPipeline } from '@/features/pipeline/useChatPipeline'
import { pipelineBus } from '@/features/pipeline'
import { getLive2DModel } from '@/features/live2d/live2dBus'
import { useASRStore, setASRFinalCallback } from '@/features/asr/asrStore'
import { extractAssistantDisplayText } from '@shared/roleCard'
import { useCharacterStore } from '@/features/character/characterStore'
import { MicButton } from './MicButton'

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
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const character = useCharacterStore((s) => s.list.find((c) => c.id === s.activeId))

  // 流式内容：拼成当前显示文本
  const streamingDisplay = streamingSegments.map((s) => s.item.text).join('')

  // 显示最后一句（历史模式显示全部）
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const displayText = streamingDisplay
    || (lastAssistant ? extractAssistantDisplayText(lastAssistant.content) : '')
  const displayName = character?.displayName ?? character?.name ?? 'OpenGal'

  // 历史展开时自动滚到底
  React.useEffect(() => {
    if (historyOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [historyOpen, messages.length, streamingSegments.length])

  // 语音识别结果：按配置自动发送或填入输入框（与桌面 ChatPanel 同源逻辑）
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

  function handleSend(): void {
    const trimmed = draft.trim()
    if (!trimmed || isSending) return
    setDraft('')
    send(trimmed)
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
                  {message.role === 'assistant'
                    ? extractAssistantDisplayText(message.content)
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

      {/* 收起/展开历史按钮 */}
      <button
        type="button"
        onClick={() => setHistoryOpen((v) => !v)}
        className="pointer-events-auto absolute right-3 top-14 z-10 flex h-6 items-center gap-0.5 rounded-full border bg-background/60 px-2 text-[10px] text-muted-foreground backdrop-blur-sm"
      >
        {historyOpen ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
        {historyOpen ? '收起' : `历史 ${messages.length}`}
      </button>

      {/* 底部对话框：居中限宽（galgame 式），人物在中间、对话框正下方 */}
      <div className="pointer-events-auto relative mx-auto mb-4 w-[calc(100%-1.5rem)] max-w-3xl rounded-2xl border bg-background/85 shadow-lg backdrop-blur-sm">
        {/* 角色名铭牌 */}
        <span className="absolute -top-3 left-4 rounded-md border bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground shadow">
          {displayName}
        </span>
        {/* 台词区：点击展开历史 */}
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

        {/* 输入区 */}
        <div className="flex items-end gap-2 px-3 pb-3 pt-1">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="输入消息..."
            className="min-h-[40px] resize-none bg-muted/50 text-sm"
            rows={1}
          />
          <MicButton />
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
              disabled={!draft.trim()}
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
