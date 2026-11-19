import * as React from 'react'
import { Pause, Play, RefreshCw, Sparkles } from 'lucide-react'
import type { RoleMode, RoleStateSnapshot } from '@core/role/types'
import type { RoleCardEntry } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useRoleStore } from '@/features/role/roleStore'

interface Props {
  role: RoleCardEntry
}

const MOOD_LABELS: Record<string, string> = {
  neutral: '平静',
  happy: '愉快',
  sad: '低落',
  thinking: '思索',
  sleepy: '犯困',
  relaxed: '放松',
  excited: '兴奋',
  angry: '生气',
  surprised: '惊讶',
  shy: '害羞',
  proud: '得意',
}

export function RoleStatusPanel({ role }: Props): React.JSX.Element {
  const [state, setState] = React.useState<RoleStateSnapshot | null>(null)
  const [running, setRunning] = React.useState(false)
  const [lifePaused, setLifePaused] = React.useState(true)
  const [thinking, setThinking] = React.useState(false)
  const [relationshipStage, setRelationshipStage] = React.useState('')
  const [shortTermGoal, setShortTermGoal] = React.useState('')
  const [savingState, setSavingState] = React.useState(false)
  const [ticking, setTicking] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')

  const currentMode: RoleMode = role.mode ?? 'agent'

  const loadData = React.useCallback(async () => {
    const [stateRes, snapRes] = await Promise.all([
      window.opengal.role.getState(role.id),
      window.opengal.runtime.snapshot().catch(() => null),
    ])
    if (stateRes.success && stateRes.data) {
      setState(stateRes.data)
      setRelationshipStage(stateRes.data.relationshipStage)
      setShortTermGoal(stateRes.data.shortTermGoal)
    }
    const item = snapRes?.success ? snapRes.data?.roles[role.id] : undefined
    if (item) {
      setRunning(item.running)
      setLifePaused(item.lifePaused)
      setThinking(item.thinking)
    }
  }, [role.id])

  React.useEffect(() => {
    void loadData()
    const off = window.opengal.runtime.onChanged((snap) => {
      const item = snap.roles[role.id]
      if (item) {
        setRunning(item.running)
        setLifePaused(item.lifePaused)
        setThinking(item.thinking)
        setState(item.state)
      }
    })
    return () => {
      off()
    }
  }, [loadData, role.id])

  async function switchMode(mode: RoleMode): Promise<void> {
    setError('')
    setNotice('')
    const res = await window.opengal.runtime.setMode(role.id, mode)
    if (!res.success) {
      setError(res.error ?? '模式切换失败')
      return
    }
    await useRoleStore.getState().loadRoles(role.id)
    await loadData()
  }

  async function toggleLifeLoop(): Promise<void> {
    setError('')
    const nextPaused = !lifePaused
    const res = await window.opengal.runtime.setLifePaused(role.id, nextPaused)
    if (!res.success) {
      setError(res.error ?? '切换自主循环失败')
      return
    }
    await loadData()
  }

  async function handleTriggerTick(): Promise<void> {
    setTicking(true)
    setError('')
    try {
      await window.opengal.runtime.triggerLifeTick(role.id)
      await loadData()
    } finally {
      setTicking(false)
    }
  }

  async function handleSaveState(): Promise<void> {
    setSavingState(true)
    setError('')
    setNotice('')
    try {
      const res = await window.opengal.role.patchState(role.id, {
        relationshipStage: relationshipStage.trim() || '初识朋友',
        shortTermGoal: shortTermGoal.trim(),
      })
      if (res.success && res.data) {
        setState(res.data)
        setNotice('已更新当前关系阶段与心事')
      } else {
        setError(res.error ?? '状态保存失败')
      }
    } finally {
      setSavingState(false)
    }
  }

  const moodText = state?.mood ? (MOOD_LABELS[state.mood] ?? state.mood) : '平静'

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
          {notice}
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">运行模式</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void switchMode('agent')}
            className={cn(
              'flex flex-col items-start gap-1 rounded-lg border p-3.5 text-left transition-colors',
              currentMode === 'agent' ? 'border-brand bg-brand/10' : 'bg-card hover:bg-accent/50',
            )}
          >
            <span className="text-sm font-medium">Agent 伴随模式</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              围绕你的发起行动；支持喊角色名字唤醒对话，平时低消耗待命。
            </span>
          </button>

          <button
            type="button"
            onClick={() => void switchMode('life')}
            className={cn(
              'flex flex-col items-start gap-1 rounded-lg border p-3.5 text-left transition-colors',
              currentMode === 'life' ? 'border-brand bg-brand/10' : 'bg-card hover:bg-accent/50',
            )}
          >
            <span className="text-sm font-medium">Life 自主生活模式</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              持续自主循环：自己检索兴趣话题、观察桌面、写日记、换装或在有感而发时开口。
            </span>
          </button>
        </div>
      </section>

      {currentMode === 'life' ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <div className="min-w-[200px] flex-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'size-2 rounded-full',
                  running && !lifePaused ? 'bg-brand' : 'bg-muted-foreground/40',
                )}
              />
              <span className="text-sm font-medium">
                {!running
                  ? '角色休息中（唤醒后可开始自主生活）'
                  : lifePaused
                    ? '自主循环已暂停（重开应用默认先暂停，避免静默产生费用）'
                    : thinking
                      ? '正在自主思考与行动…'
                      : '自主生活循环运行中'}
              </span>
            </div>
            {state?.nextTickAt && running && !lifePaused ? (
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                下次自主思考预计在{' '}
                {new Date(state.nextTickAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={running && !lifePaused ? 'outline' : 'default'}
              size="sm"
              onClick={() => void toggleLifeLoop()}
            >
              {running && !lifePaused ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              {running && !lifePaused ? '暂停循环' : '开始自主生活'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleTriggerTick()}
              disabled={!running || ticking || thinking}
            >
              <Sparkles className="size-3.5" />
              {ticking || thinking ? '思考中…' : '立即行动一次'}
            </Button>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 border-t pt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">实时体征与关系阶段</h2>
          <Button type="button" variant="ghost" size="sm" onClick={() => void loadData()}>
            <RefreshCw className="size-3.5" />
            刷新
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-lg border bg-card p-3.5">
          <div>
            <span className="text-xs text-muted-foreground">当前心情</span>
            <p className="mt-0.5 text-sm font-medium">{moodText}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">当前精力</span>
            <p className="mt-0.5 text-sm font-medium tabular-nums">{state?.energy ?? 85} / 100</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">当下动态</span>
            <p className="mt-0.5 truncate text-sm font-medium">{state?.currentActivity ?? '待命'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium">与你的关系阶段</label>
            <Input
              value={relationshipStage}
              onChange={(e) => setRelationshipStage(e.target.value)}
              placeholder="例如：初识朋友 / 熟稔搭档"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium">近期打算或心事</label>
            <Input
              value={shortTermGoal}
              onChange={(e) => setShortTermGoal(e.target.value)}
              placeholder="可选"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleSaveState()}
            disabled={savingState}
          >
            {savingState ? '保存中…' : '保存状态设定'}
          </Button>
        </div>
      </section>
    </div>
  )
}
