import * as React from 'react'
import { ArrowLeft, Brain, Copy, Palette, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MemorySettings } from '@/components/settings/MemorySettings'
import { useRoleStore } from '@/features/role/roleStore'
import type { RoleCardEntry } from '@shared/types'
import { PersonaPanel } from './PersonaPanel'
import { AppearancePanel } from './AppearancePanel'

interface Props {
  role: RoleCardEntry | null
  onClose: () => void
  onOpenDisplaySettings: () => void
  onOpenTtsSettings: () => void
  onOpenModelSettings: () => void
}

export function RoleStudio({
  role,
  onClose,
  onOpenDisplaySettings,
  onOpenTtsSettings,
  onOpenModelSettings,
}: Props): React.JSX.Element {
  const [tab, setTab] = React.useState('persona')
  const [copying, setCopying] = React.useState(false)
  const [copyError, setCopyError] = React.useState('')
  const [copyNotice, setCopyNotice] = React.useState('')

  async function refreshRole(): Promise<void> {
    await useRoleStore.getState().loadRoles(useRoleStore.getState().activeId)
  }

  async function createCopy(): Promise<void> {
    if (!role) return
    setCopying(true)
    setCopyError('')
    setCopyNotice('')
    try {
      const response = await window.opengal.role.createCopy(role.id)
      if (!response.success) {
        setCopyError(response.error ?? '创建副本失败')
        return
      }
      await refreshRole()
      setCopyNotice('已创建可编辑副本，现在可以修改了')
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : '创建副本失败')
    } finally {
      setCopying(false)
    }
  }

  if (!role) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background">
        <p className="text-sm">请选择一个角色</p>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>返回</Button>
      </div>
    )
  }

  const label = role.displayName ?? role.name

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          title="返回"
          aria-label="返回"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">角色设定</h1>
          <p className="truncate text-xs text-muted-foreground">
            {label}
            <span className="mx-1.5 text-border">/</span>
            修改会保存到这个角色自己的角色卡
          </p>
        </div>
        {role.builtin ? (
          <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            市场模板
          </span>
        ) : null}
      </header>

      <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="flex min-h-0 flex-1">
        <TabsList className="h-full w-14 shrink-0 flex-col items-stretch justify-start gap-0.5 rounded-none border-r bg-transparent p-2 sm:w-44">
          <TabsTrigger
            value="persona"
            className="w-full justify-start gap-2.5 px-2.5 py-2 text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
          >
            <UserRound className="size-4 shrink-0" />
            <span className="hidden sm:inline">人设</span>
          </TabsTrigger>
          <TabsTrigger
            value="memory"
            className="w-full justify-start gap-2.5 px-2.5 py-2 text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
          >
            <Brain className="size-4 shrink-0" />
            <span className="hidden sm:inline">记忆</span>
          </TabsTrigger>
          <TabsTrigger
            value="appearance"
            className="w-full justify-start gap-2.5 px-2.5 py-2 text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
          >
            <Palette className="size-4 shrink-0" />
            <span className="hidden sm:inline">外观与声音</span>
          </TabsTrigger>
        </TabsList>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-6">
            {role.builtin ? (
              <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                <span className="min-w-0 flex-1">这是市场模板，直接修改会污染模板。先创建一份属于你的角色，再编辑人设和记忆。</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void createCopy()}
                  disabled={copying}
                >
                  <Copy className="size-3.5" />
                  {copying ? '创建中…' : '创建可编辑副本'}
                </Button>
              </div>
            ) : null}
            {copyError ? <div className="mb-4 text-xs text-destructive">{copyError}</div> : null}
            {copyNotice ? <div className="mb-4 text-xs text-muted-foreground">{copyNotice}</div> : null}
            <TabsContent value="persona" className="mt-0">
              <PersonaPanel key={role.id} role={role} onSaved={() => void refreshRole()} />
            </TabsContent>
            <TabsContent value="memory" className="mt-0">
              <MemorySettings key={role.id} roleId={role.id} />
            </TabsContent>
            <TabsContent value="appearance" className="mt-0">
              <AppearancePanel
                role={role}
                onOpenDisplaySettings={onOpenDisplaySettings}
                onOpenTtsSettings={onOpenTtsSettings}
                onOpenModelSettings={onOpenModelSettings}
              />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  )
}
