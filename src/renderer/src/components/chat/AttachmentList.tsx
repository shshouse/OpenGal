/**
 * 附件列表：显示本轮引用的知识库文件，点击展开查看每行内容。
 * 挂在用户气泡下方（右边），样式类似 ToolCallList。
 */

import * as React from 'react'
import { FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RagAttachment } from '@/features/chat/chatStore'

export interface AttachmentListProps {
  attachments: RagAttachment[]
  align?: 'left' | 'right'
}

export function AttachmentList({ attachments, align = 'right' }: AttachmentListProps): React.ReactElement {
  return (
    <div className={cn('flex flex-col gap-1', align === 'right' ? 'items-end' : 'items-start')}>
      {attachments.map((att) => (
        <AttachmentCard key={att.fileName} attachment={att} />
      ))}
    </div>
  )
}

interface AttachmentCardProps {
  attachment: RagAttachment
}

function AttachmentCard({ attachment }: AttachmentCardProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const totalLines = attachment.content.split('\n').length
  const size = new Blob([attachment.content]).size
  return (
    <div className="rounded-md border border-border bg-muted/40 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground hover:text-foreground active:scale-[0.99] transition-all duration-150"
      >
        {expanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        <FileText className="size-3 shrink-0" />
        <span className="font-mono text-[11px]">{attachment.fileName}</span>
        <span className="ml-1 text-[10px] text-muted-foreground">· {totalLines} 行 · {size}B</span>
      </button>
      {expanded && (
        <pre className="mx-2 mb-2 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
{
  attachment.content
    .split('\n')
    .map((line, i) => `行${i + 1}: ${line}`)
    .join('\n')
}
        </pre>
      )}
    </div>
  )
}
