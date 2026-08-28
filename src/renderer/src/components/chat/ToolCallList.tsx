import * as React from 'react'
import { ChevronDown, ChevronRight, Wrench, CircleAlert, CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCallRecord } from '@/features/tools/toolCallsStore'

export interface ToolCallListProps {
  records: ToolCallRecord[]
}

export function ToolCallList({ records }: ToolCallListProps): React.ReactElement | null {
  if (records.length === 0) return null
  return (
    <div className="ml-2 mt-1 flex flex-col gap-1">
      {records.map((r) => (
        <ToolCallCard key={r.id} record={r} />
      ))}
    </div>
  )
}

interface ToolCallCardProps {
  record: ToolCallRecord
}

function ToolCallCard({ record }: ToolCallCardProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const StatusIcon = record.ok ? CircleCheck : CircleAlert
  return (
    <div
      className={cn(
        'rounded-md border bg-muted/40 text-xs',
        record.ok ? 'border-border' : 'border-destructive/40'
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/60 active:scale-[0.99] transition-all duration-150"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <Wrench className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-mono font-medium">{record.name}</span>
        <StatusIcon
          className={cn(
            'size-3 shrink-0',
            record.ok ? 'text-emerald-500' : 'text-destructive'
          )}
        />
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
          {record.durationMs}ms
        </span>
      </button>
      {expanded && (
        <div className="border-t px-2 py-1.5 space-y-1.5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">参数</div>
            <pre className="mt-0.5 overflow-x-auto rounded bg-background/60 px-1.5 py-1 font-mono text-[11px]">
              {Object.keys(record.args).length > 0
                ? JSON.stringify(record.args, null, 2)
                : '(无)'}
            </pre>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {record.ok ? '返回' : '错误'}
            </div>
            <pre
              className={cn(
                'mt-0.5 overflow-x-auto rounded px-1.5 py-1 font-mono text-[11px] whitespace-pre-wrap break-all',
                record.ok ? 'bg-background/60' : 'bg-destructive/10 text-destructive'
              )}
            >
              {record.result}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
