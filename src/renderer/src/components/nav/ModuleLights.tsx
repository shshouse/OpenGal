import type { BootStepStatus } from '@shared/types'
import { useStartupStore } from '@/features/startup/startupStore'
import { cn } from '@/lib/utils'

const STATUS_TEXT: Record<BootStepStatus, string> = {
  pending: '待启动',
  running: '加载中',
  ok: '正常',
  failed: '失败',
  skipped: '已跳过'
}

const DOT_CLASS: Record<BootStepStatus, string> = {
  pending: 'bg-white/20',
  running: 'animate-pulse bg-sky-400',
  ok: 'bg-emerald-400',
  failed: 'bg-red-400',
  skipped: 'bg-white/40'
}

export function ModuleLights() {
  const steps = useStartupStore((s) => s.steps)
  return (
    <div className="mt-auto flex items-center justify-center gap-1.5 pb-1 pt-2">
      {steps.map((s) => (
        <span
          key={s.id}
          title={`${s.label}: ${STATUS_TEXT[s.status]}${s.detail ? `，${s.detail}` : ''}`}
          className={cn('size-2 rounded-full', DOT_CLASS[s.status])}
        />
      ))}
    </div>
  )
}
