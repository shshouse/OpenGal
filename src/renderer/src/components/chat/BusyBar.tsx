import * as React from 'react'
import { Brain } from 'lucide-react'
import { pipelineBus } from '@/features/pipeline'

const PREVIEW_MAX = 200

function compactReasoning(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_MAX)
}

export function BusyBar() {
  const [text, setText] = React.useState('')

  React.useEffect(() => {
    const offReasoning = pipelineBus.on('llm:reasoning', (msg) => {
      setText(compactReasoning(msg.accumulated))
    })
    const offDone = pipelineBus.on('llm:done', () => {
      setText('')
    })
    const offAbort = pipelineBus.on('pipeline:abort', () => {
      setText('')
    })
    return () => {
      offReasoning()
      offDone()
      offAbort()
    }
  }, [])

  if (!text) return null

  return (
    <div className="flex items-center gap-2 border-t bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
      <Brain className="size-3.5 shrink-0 text-amber-500" />
      <span className="truncate">{text}</span>
    </div>
  )
}
