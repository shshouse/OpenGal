import * as React from 'react'
import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getContextUsage, setGlobalContextWindow } from '@/features/pipeline/llmWorker'
import { useChatStore } from '@/features/chat/chatStore'
import { useCharacterStore } from '@/features/character/characterStore'

interface Segment {
  label: string
  tokens: number
  color: string
}

async function buildSegments(): Promise<{ segments: Segment[]; total: number; max: number } | null> {
  const res = await window.opengal.config.get()
  const globalMax = res.data?.llm?.contextWindow ?? res.data?.llm?.maxTokens ?? 4096
  setGlobalContextWindow(globalMax)
  const usage = getContextUsage()
  if (!usage) return null
  const { systemTokens, memoryTokens, historyTokens, totalTokens, maxTokens } = usage
  const freeTokens = Math.max(0, maxTokens - totalTokens)
  const segments: Segment[] = [
    { label: '系统提示词', tokens: systemTokens, color: '#8b5cf6' },
    { label: '记忆', tokens: memoryTokens, color: '#06b6d4' },
    { label: '对话历史', tokens: historyTokens, color: '#f59e0b' },
    { label: '未使用', tokens: freeTokens, color: '#27272a' },
  ]
  return { segments, total: totalTokens, max: maxTokens }
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle)
  const end = polarToCartesian(cx, cy, r, startAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`
}

const SIZE = 28
const CENTER = SIZE / 2
const RADIUS = SIZE / 2 - 1

export function ContextUsageIndicator() {
  const messages = useChatStore((s) => s.messages)
  const activeId = useCharacterStore((s) => s.activeId)
  const [data, setData] = React.useState<{ segments: Segment[]; total: number; max: number } | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void buildSegments().then((d) => {
        if (!cancelled) setData(d)
      })
    }
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [messages.length, activeId])

  if (!data) return null

  const { segments, total, max } = data
  const usagePercent = Math.min(100, Math.round((total / max) * 100))

  let cumulative = 0

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-background/60 backdrop-blur-sm transition-colors hover:bg-accent"
          title="上下文使用量"
        >
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            {segments.map((seg) => {
              if (max <= 0 || seg.tokens <= 0) return null
              const startAngle = (cumulative / max) * 360
              cumulative += seg.tokens
              const endAngle = (cumulative / max) * 360
              if (endAngle - startAngle < 0.5) return null
              return (
                <path
                  key={seg.label}
                  d={describeArc(CENTER, CENTER, RADIUS, startAngle, endAngle)}
                  fill={seg.color}
                />
              )
            })}
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS - 3}
              fill="hsl(var(--background))"
            />
            <text
              x={CENTER}
              y={CENTER}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-foreground text-[8px] font-medium"
            >
              {usagePercent}%
            </text>
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" side="top" align="end">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Info className="size-3" />
            上下文使用
          </div>
          <div className="space-y-1">
            {segments.map((seg) => {
              const ratio = max > 0 ? (seg.tokens / max) * 100 : 0
              const percent = seg.tokens > 0 && ratio < 1 ? '<1' : String(Math.round(ratio))
              return (
                <div key={seg.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="size-2 rounded-full"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span className="text-muted-foreground">{seg.label}</span>
                  </div>
                  <span>
                    {formatTokens(seg.tokens)} ({percent}%)
                  </span>
                </div>
              )
            })}
          </div>
          <div className="border-t pt-1.5 text-xs text-muted-foreground">
            总计 {formatTokens(total)} / {formatTokens(max)} tokens
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
