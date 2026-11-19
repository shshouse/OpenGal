import * as React from 'react'
import { FolderOutput, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import type { LifeLogEntry, RoleMode, RoleStateSnapshot } from '@core/role/types'
import type { RoleCardEntry } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useRoleStore } from '@/features/role/roleStore'

interface Props {
  role: RoleCardEntry
  onDeleted: () => void
}

const KIND_LABELS: Record<string, string> = {
  diary: '日记',
  observation: '见闻',
  action: '行动',
  thought: '独白',
}

export function LifeStatePanel({ role, onDeleted }: Props): React.JSX.Element {
  const [state, setState] = React.useState<RoleStateSnapshot | null>(null)
  const [logs, setLogs] = React.useState<LifeLogEntry[]>([])
  const [relationshipStage, setRelationshipStage] = React.useState('')
  const [shortTermGoal, setShortTermGoal] = React.useState('')
  const [savingState, setSavingState] = React.useState(false)
  const [ticking, setTicking] = React.useState(false)
  const [exportNotice, setExportNotice] = React.useState('')
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [error, setError] = React.useState('')

  const currentMode: RoleMode = role.mode ?? 'agent'

  const loadData = React.useCallback(async () => {
    const [stateRes, logRes] = await Promise.all([
      window.opengal.role.getState(role.id),
      window.opengal.role.lifeLogs(role.id, 40),
    ])
    if (stateRes.success && stateRes.data) {
      setState(stateRes.data)
      setRelationshipStage(stateRes.data.relationshipStage)
      setShortTermGoal(stateRes.data.shortTermGoal)
    }
    if (logRes.success && logRes.data) {
      setLogs([...logRes.data].reverse())
    }
  }, [role.id])

  React.useEffect(() => {
    void loadData()
    const off = window.opengal.runtime.onChanged(() => {
      void loadData()
    })
    return () => {
      off()
    }
  }, [loadData])

  async function switchMode(mode: RoleMode): Promise<void> {
    setError('')
    const res = await window.opengal.runtime.setMode(role.id, mode)
    if (!res.success) {
      setError(res.error ?? '模式切换失败')
      return
    }
    await useRoleStore.getState().loadRoles(role.id)
    await loadData()
  }

  async function handleSaveState(): Promise<void> {
    setSavingState(true)
    setError('')
    try {
      const res = await window.opengal.role.patchState(role.id, {
        relationshipStage: relationshipStage.trim() || '初识朋友',
        shortTermGoal: shortTermGoal.trim(),
      })
      if (res.success && res.data) setState(res.data)
      else setError(res.error ?? '状态保存失败')
    } finally {
      setSavingState(false)
    }
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

  async function handleExportFolder(): Promise<void> {
    setError('')
    setExportNotice('')
    const res = await window.opengal.role.exportFolder(role.id)
    if (!res.success) {
      setError(res.error ?? '导出失败')
      return
    }
    if (res.data) {
      setExportNotice(`已导出完整角色目录：${res.data}`)
    }
  }

  async function handleDeleteRole(): Promise<void> {
    const res = await window.opengal.role.delete(role.id)
    if (!res.success) {
      setError(res.error ?? '移除角色失败')
      return
    }
    await useRoleStore.getState().loadRoles()
    onDeleted()
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      {exportNotice ? (
        <div className="rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
          {exportNotice}
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">生命模式</h2>
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
              持续自主运转认知循环，自己浏览感兴趣的内容、记日记、换装或主动找你分享。
            </span>
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t pt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">当前状态与关系阶段</h2>
          <div className="flex items-center gap-2">
            {currentMode === 'life' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleTriggerTick()}
                disabled={ticking}
              >
                <Sparkles className="size-3.5" />
                {ticking ? '思考中…' : '立即自主行动一次'}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={() => void loadData()}>
              <RefreshCw className="size-3.5" />
              刷新
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-lg border bg-card p-3.5">
          <div>
            <span className="text-xs text-muted-foreground">当前心情</span>
            <p className="mt-0.5 text-sm font-medium">{state?.mood ?? 'neutral'}</p>
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
              placeholder="例如：初识朋友 / 老搭档"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium">她近期的打算或心事</label>
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

      <section className="flex flex-col gap-3 border-t pt-5">
        <h2 className="text-sm font-semibold">自主生活轨迹与日记</h2>
        {logs.length === 0 ? (
          <div className="rounded-lg border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
            暂无生活轨迹记录。开启 Life 模式后，她的内心独白、浏览见闻与随笔日记会记录在这里。
          </div>
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {logs.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-1 px-3.5 py-3">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="rounded border bg-background px-1.5 py-0.5 font-medium text-foreground">
                      {KIND_LABELS[entry.kind] ?? entry.kind}
                    </span>
                    {entry.title ? <span className="font-medium text-foreground">{entry.title}</span> : null}
                  </div>
                  <span className="tabular-nums">
                    {new Date(entry.ts).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {entry.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <div>
          <h2 className="text-sm font-semibold">数据迁移与管理</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            导出后的文件夹包含该角色完整人设、聊天记录、长期记忆与立绘资源，可直接放入任意 OpenGal 的 data/roles 使用。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void handleExportFolder()}>
            <FolderOutput className="size-3.5" />
            导出角色目录
          </Button>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => void handleDeleteRole()}
              >
                确认移除
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
              移除角色
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
