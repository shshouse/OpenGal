import * as React from 'react'
import { ArrowRight, Moon, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isCharacterRunning, type CharacterRunningMap } from '@shared/characterRuntime'
import type { BootStep, RoleCardEntry } from '@shared/types'

interface Props {
  characters: RoleCardEntry[]
  activeId: string | null
  runningById: CharacterRunningMap
  steps: BootStep[]
  onOpenRole: (characterId: string) => void
  onToggleRunning: (characterId: string) => void
}

export function HomePage({ characters, activeId, runningById, steps, onOpenRole, onToggleRunning }: Props): React.JSX.Element {
  const runningCount = characters.filter((character) => isCharacterRunning(runningById, character.id)).length
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-8 p-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">OpenGal</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {characters.length} 个角色，{runningCount} 个正在运行
          </p>
        </header>

        {characters.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
            还没有角色包
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {characters.map((character) => {
              const running = isCharacterRunning(runningById, character.id)
              const label = character.displayName ?? character.name
              return (
                <section key={character.id} className="flex min-w-0 flex-col rounded-xl border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <div
                      className="flex size-11 shrink-0 items-center justify-center rounded-full border bg-background text-sm"
                      style={{ color: character.color }}
                    >
                      {label.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-medium">{label}</h2>
                        <span className={`size-2 shrink-0 rounded-full ${running ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {running ? '正在运行' : '沉睡中'}{character.id === activeId ? ' · 当前角色' : ''}
                      </p>
                    </div>
                  </div>
                  <p className="mt-4 line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
                    {character.persona.description}
                  </p>
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => onOpenRole(character.id)}>
                      <ArrowRight className="size-3.5" />进入角色
                    </Button>
                    <Button size="sm" variant={running ? 'secondary' : 'default'} onClick={() => onToggleRunning(character.id)}>
                      {running ? <Moon className="size-3.5" /> : <Play className="size-3.5" />}
                      {running ? '休眠' : '唤醒'}
                    </Button>
                  </div>
                </section>
              )
            })}
          </div>
        )}

        <section className="space-y-3 border-t pt-5">
          <h2 className="text-sm font-medium">运行环境</h2>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {steps.map((step) => (
              <div key={step.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={`size-2 rounded-full ${step.status === 'ok' ? 'bg-emerald-500' : step.status === 'failed' ? 'bg-red-500' : 'bg-muted-foreground/40'}`} />
                <span>{step.label}</span>
                <span>{step.status === 'ok' ? '正常' : step.status === 'failed' ? '失败' : step.status === 'running' ? '加载中' : step.status === 'skipped' ? '已跳过' : '待启动'}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
