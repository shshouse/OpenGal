/**
 * 底栏式思维链 / 工具调用进度预览。对齐 RachelForster 的 busy bar：
 * - 模型 reasoning 增量到来时，单行展示（去标签、去多余空白、超长省略）
 * - 一轮 LLM 结束后自动消失
 * - 后续可扩展显示 TTS / 工具调用等其它阶段提示
 */

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
