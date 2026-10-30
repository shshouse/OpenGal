import * as React from 'react'
import { Activity, AlertCircle, CheckCircle2, Moon, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LogsPanel } from '@/components/logs/LogsPanel'
import { selectActivities, useActivityStore } from '@/features/activity/activityStore'
import { useStartupStore } from '@/features/startup/startupStore'
import type { RoleCardEntry } from '@shared/types'
import { ActivityTimeline } from './ActivityTimeline'
import { MemoryDashboard } from './MemoryDashboard'

interface Props {
  character: RoleCardEntry
  running: boolean
  onToggleRunning: () => void
}

export function RoleDashboard({ character, running, onToggleRunning }: Props): React.JSX.Element {
  const activities = useActivityStore((state) => selectActivities(state, character.id))
  const steps = useStartupStore((state) => state.steps)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayCount = activities.filter((entry) => entry.at >= today.getTime()).length
  const errorCount = activities.filter((entry) => entry.kind === 'error').length
  const healthyCount = steps.filter((step) => step.status === 'ok').length
  const label = character.displayName ?? character.name

  return (
    <Tabs defaultValue="overview" className="flex h-full min-w-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">{label}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{running ? '正在运行' : '沉睡中'}</p>
        </div>
        <Button size="sm" variant={running ? 'secondary' : 'default'} onClick={onToggleRunning}>
          {running ? <Moon className="size-3.5" /> : <Play className="size-3.5" />}
          {running ? '休眠' : '唤醒'}
        </Button>
      </header>
      <div className="shrink-0 border-b px-3 py-2">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="memory">记忆</TabsTrigger>
          <TabsTrigger value="activity">轨迹</TabsTrigger>
          <TabsTrigger value="logs">日志</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 p-4">
          <div className="grid grid-cols-3 gap-2">
            <OverviewStat icon={Activity} label="今日活动" value={todayCount} />
            <OverviewStat icon={CheckCircle2} label="正常模块" value={`${healthyCount}/${steps.length}`} />
            <OverviewStat icon={AlertCircle} label="回应错误" value={errorCount} />
          </div>
          <section className="space-y-3">
            <h2 className="text-sm font-medium">模块状态</h2>
            <div className="space-y-2">
              {steps.map((step) => (
                <div key={step.id} className="flex items-center gap-3 text-xs">
                  <span className={`size-2 rounded-full ${step.status === 'ok' ? 'bg-emerald-500' : step.status === 'failed' ? 'bg-red-500' : 'bg-muted-foreground/40'}`} />
                  <span className="flex-1">{step.label}</span>
                  <span className="text-muted-foreground">{step.status === 'ok' ? '正常' : step.status === 'failed' ? '失败' : step.status === 'running' ? '加载中' : step.status === 'skipped' ? '已跳过' : '待启动'}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-medium">最近活动</h2>
            <ActivityTimeline entries={activities} limit={5} />
          </section>
        </div>
      </TabsContent>
      <TabsContent value="memory" className="min-h-0 flex-1 overflow-y-auto">
        <MemoryDashboard key={character.id} characterId={character.id} />
      </TabsContent>
      <TabsContent value="activity" className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-4"><ActivityTimeline entries={activities} /></div>
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1 overflow-hidden">
        <LogsPanel embedded />
      </TabsContent>
    </Tabs>
  )
}

function OverviewStat({ icon: Icon, label, value }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}
