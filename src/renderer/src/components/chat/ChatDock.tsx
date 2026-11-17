import * as React from 'react'
import type { ChatMessage } from '@shared/types'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/features/chat/chatStore'
import { useRoleStore } from '@/features/role/roleStore'
import { displaySubtitle, useSubtitleStore } from '@/features/speech/subtitles'
import { messageImages, messageText } from '@/features/chat/sessionPreview'
import { ChatThread } from './ChatThread'

interface Props {
  roleLabel: string
}

export function ChatDock({ roleLabel }: Props): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false)
  const messages = useChatStore((s) => s.messages)
  const streamingSegments = useChatStore((s) => s.streamingSegments)
  const roleId = useRoleStore((s) => s.activeId)
  useSubtitleStore((s) => s.records)
  useSubtitleStore((s) => s.preferences)

  const last = messages[messages.length - 1]
  const streaming = streamingSegments.map((segment) => segment.item.text).join('')
  const text = streaming
    ? displaySubtitle(roleId ?? '', streaming)
    : last
      ? displaySubtitle(roleId ?? '', messageText(last as ChatMessage))
      : ''
  const hasImages = last ? messageImages(last as ChatMessage).length > 0 : false
  const canExpand = messages.length > 0 || streaming.length > 0

  React.useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded])

  function collapse(event: React.MouseEvent<HTMLDivElement>): void {
    if (window.getSelection()?.toString()) return
    if ((event.target as HTMLElement).closest('button, a')) return
    setExpanded(false)
  }

  return (
    <div className="relative mx-auto w-full max-w-3xl">
      {expanded ? (
        <div
          className="absolute bottom-full left-0 right-0 z-30 mb-2 flex max-h-[min(60vh,30rem)] min-h-[200px] cursor-pointer flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
          onClick={collapse}
          role="region"
          aria-label="对话记录，点击收起"
        >
          <ChatThread roleLabel={roleLabel} showAvatar={false} />
        </div>
      ) : null}

      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? '收起对话记录' : '展开对话记录'}
          className="block w-full cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <div
            aria-live="polite"
            className={cn(
              'max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed',
              streaming && 'border-brand/30',
            )}
          >
            {text || (hasImages ? '图片' : '…')}
          </div>
        </button>
      ) : (
        <div className="rounded-lg border border-dashed bg-background px-3 py-2 text-sm text-muted-foreground">
          还没有消息，说第一句话开始和{roleLabel}对话。
        </div>
      )}
    </div>
  )
}
