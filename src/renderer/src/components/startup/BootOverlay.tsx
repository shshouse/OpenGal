import * as React from 'react'
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from 'lucide-react'
import type { BootStep } from '@shared/types'
import { useStartupStore } from '@/features/startup/startupStore'
import { cn } from '@/lib/utils'

function StepRow({ step }: { step: BootStep }) {
  const icon = {
    pending: <Circle className="size-3.5 text-white/30" />,
    running: <Loader2 className="size-3.5 animate-spin text-sky-300" />,
    ok: <CheckCircle2 className="size-3.5 text-emerald-400" />,
    failed: <XCircle className="size-3.5 text-red-400" />,
    skipped: <MinusCircle className="size-3.5 text-white/40" />
  }[step.status]
  return (
    <div className="flex items-center gap-2 text-xs">
      {icon}
      <span
        className={cn(
          step.status === 'failed' ? 'text-red-300' : 'text-white/85',
          step.status === 'pending' && 'text-white/40'
        )}
      >
        {step.label}
      </span>
      {step.detail && (
        <span className={cn('ml-auto text-[10px]', step.status === 'failed' ? 'text-red-300/80' : 'text-white/40')}>
          {step.detail}
        </span>
      )}
    </div>
  )
}

export function BootOverlay() {
  const phase = useStartupStore((s) => s.phase)
  const steps = useStartupStore((s) => s.steps)
  const [hidden, setHidden] = React.useState(false)

  React.useEffect(() => {
    if (phase === 'waking') {
      const t = window.setTimeout(() => setHidden(true), 500)
      return () => window.clearTimeout(t)
    }
    if (phase === 'booting') setHidden(false)
  }, [phase])

  if (phase === 'awake' && hidden) return null

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-30 flex items-end justify-center pb-24 transition-opacity duration-500',
        (phase === 'waking' || hidden) && 'opacity-0'
      )}
    >
      <div className="w-64 rounded-xl border border-white/10 bg-black/50 px-4 py-3 shadow-xl backdrop-blur-md">
        <div className="mb-2 text-xs font-medium tracking-wide text-white/80">
          {phase === 'booting' ? '正在唤醒…' : '唤醒完成'}
        </div>
        <div className="space-y-1.5">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </div>
      </div>
    </div>
  )
}
