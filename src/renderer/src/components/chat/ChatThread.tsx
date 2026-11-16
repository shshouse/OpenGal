import * as React from 'react'
import { ArrowDown } from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/features/chat/chatStore'
import { useRoleStore } from '@/features/role/roleStore'
import { useSpokenLineStore } from '@/features/speech/spokenLine'
import { displaySubtitle, subtitleForSegment, useSubtitleStore } from '@/features/speech/subtitles'
import { formatPreviewTime, messageText } from '@/features/chat/sessionPreview'

interface Props {
  roleLabel: string
  avatarUrl?: string | null
  roleColor?: string
}

function imagesOf(message: ChatMessage): string[] {
  const pending = (message as ChatMessage & { images?: unknown }).images
  if (Array.isArray(pending)) {
    return pending.filter((url): url is string => typeof url === 'string')
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter((part) => part.type === 'image_url')
      .map((part) => part.image_url.url)
  }
  return []
}

function MessageRow({
  text,
  images,
  time,
  roleLabel,
  avatarUrl,
  roleColor,
  isUser,
  pending,
}: {
  text: string
  images: string[]
  time: string
  roleLabel: string
  avatarUrl?: string | null
  roleColor?: string
  isUser: boolean
  pending?: boolean
}): React.JSX.Element {
  return (
    <div className={cn('flex items-start gap-2.5', isUser && 'flex-row-reverse')}>
      <span
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background text-xs',
          isUser ? 'text-muted-foreground' : 'text-brand',
        )}
        style={isUser ? undefined : { color: roleColor }}
        title={isUser ? undefined : roleLabel}
      >
        {!isUser && avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          (isUser ? '我' : roleLabel.slice(0, 1))
        )}
      </span>
      <div className={cn('min-w-0 max-w-[min(85%,44rem)]', isUser && 'text-right')}>
        <div
          className={cn(
            'inline-block max-w-full rounded-lg border px-3 py-2 text-left text-sm leading-relaxed',
            isUser ? 'border-brand/20 bg-brand/10' : 'border-border/60 bg-card/90',
            pending && 'border-brand/30',
          )}
        >
          {text ? <p className="whitespace-pre-wrap break-words">{text}</p> : null}
          {images.length > 0 ? (
            <div className={cn('flex flex-wrap gap-1.5', text && 'mt-2')}>
              {images.map((url, index) => (
                <img
                  key={index}
                  src={url}
                  alt="附件图片"
                  className="max-h-44 max-w-full rounded-md object-cover"
                />
              ))}
            </div>
          ) : null}
        </div>
        {time ? (
          <div className="mt-1 text-xs tabular-nums text-muted-foreground">{time}</div>
        ) : null}
      </div>
    </div>
  )
}

export function ChatThread({ roleLabel, avatarUrl, roleColor }: Props): React.JSX.Element {
  const messages = useChatStore((s) => s.messages)
  const streamingSegments = useChatStore((s) => s.streamingSegments)
  const roleId = useRoleStore((s) => s.activeId)
  const spoken = useSpokenLineStore((s) => s)
  useSubtitleStore((s) => s.records)
  useSubtitleStore((s) => s.preferences)

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const atBottomRef = React.useRef(true)
  const [showJump, setShowJump] = React.useState(false)

  const subtitle = (text: string): string => displaySubtitle(roleId ?? '', text)
  const streamingDisplay = streamingSegments.map((segment) => segment.item.text).join('')

  function latestReply(): string {
    const last = [...messages].reverse().find((message) => message.role === 'assistant')
    return last ? subtitle(messageText(last as ChatMessage)) : ''
  }

  // 有语音时文字跟发声逐句推进；语音被跳过或没启用时整段显示。
  function currentText(): string {
    if (spoken.mode === 'speech') {
      const spokenRoleId = spoken.roleId
      const line = spokenRoleId && spokenRoleId === roleId && spoken.text
        ? subtitleForSegment(spokenRoleId, spoken.segmentId, spoken.text)
        : ''
      return line || latestReply()
    }
    if (spoken.mode === 'text') return streamingDisplay ? subtitle(streamingDisplay) : latestReply()
    const first = streamingSegments[0]?.item.text
    return first ? subtitle(first) : latestReply()
  }

  // 只在生成中显示临时气泡；已落库的消息由消息列表负责，避免同一句出现两次
  const isStreaming = streamingSegments.length > 0
  const visible = isStreaming ? currentText() : ''
  const renderedMessages = isStreaming && messages[messages.length - 1]?.role === 'assistant'
    ? messages.slice(0, -1)
    : messages
  const empty = renderedMessages.length === 0 && !visible

  React.useEffect(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages.length, visible, roleId])

  function handleScroll(): void {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    atBottomRef.current = nearBottom
    setShowJump(!nearBottom)
  }

  function jumpToLatest(): void {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setShowJump(false)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {empty ? (
            <div className="flex flex-col items-center justify-center gap-1.5 py-16 text-center">
              <p className="text-sm">还没有消息</p>
              <p className="text-xs leading-relaxed text-muted-foreground">说第一句话，开始和{roleLabel}对话。</p>
            </div>
          ) : (
            renderedMessages.map((message, index) => {
              const raw = messageText(message as ChatMessage)
              const text = message.role === 'assistant' ? subtitle(raw) : raw
              const images = imagesOf(message as ChatMessage)
              if (!text && images.length === 0) return null
              return (
                <MessageRow
                  key={message.dbId ?? `${message.role}-${index}`}
                  text={text}
                  images={images}
                  time={formatPreviewTime(message.ts ?? null)}
                  roleLabel={roleLabel}
                  avatarUrl={avatarUrl}
                  roleColor={roleColor}
                  isUser={message.role === 'user'}
                />
              )
            })
          )}
          {visible ? (
            <div aria-live="polite">
              <MessageRow
                text={visible}
                images={[]}
                time=""
                roleLabel={roleLabel}
                avatarUrl={avatarUrl}
                roleColor={roleColor}
                isUser={false}
                pending
              />
            </div>
          ) : null}
        </div>
      </div>
      {showJump ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="edge absolute bottom-3 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full bg-card px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowDown className="size-3" />
          回到最新
        </button>
      ) : null}
    </div>
  )
}
