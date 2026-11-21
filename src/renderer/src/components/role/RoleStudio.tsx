import * as React from 'react'
import { Activity, BookOpen, Brain, Compass, Palette, UserRound } from 'lucide-react'
import type { RoleCardEntry } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MemorySettings } from '@/components/settings/MemorySettings'
import { useRoleStore } from '@/features/role/roleStore'
import { PersonaPanel } from './PersonaPanel'
import { RoleDiaryPanel } from './RoleDiaryPanel'
import { RoleStatusPanel } from './RoleStatusPanel'
import { RoleTracePanel } from './RoleTracePanel'
import { RoleTransferPanel } from './RoleTransferPanel'

interface Props {
  role: RoleCardEntry | null
  onClose: () => void
  onRoleDeleted: () => void
  onOpenDisplaySettings: () => void
  onOpenTtsSettings: () => void
  onOpenModelSettings: () => void
  avatarSrc?: string | null
  onRequestAvatarSrc?: () => void
}

export function RoleStudio({
  role,
  onClose,
  onRoleDeleted,
  onOpenDisplaySettings,
  onOpenTtsSettings,
  onOpenModelSettings,
  avatarSrc,
  onRequestAvatarSrc,
}: Props): React.JSX.Element {
  const [tab, setTab] = React.useState('status')

  async function refreshRole(): Promise<void> {
    await useRoleStore.getState().loadRoles(useRoleStore.getState().activeId)
  }

  if (!role) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background">
        <p className="text-sm text-muted-foreground">当前没有选中的角色</p>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          去创建角色
        </Button>
      </div>
    )
  }

  const label = role.displayName ?? role.name

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-card px-4">
        <h1 className="truncate text-sm font-semibold">{label} · 角色档案</h1>
        <span className="truncate text-xs text-muted-foreground">
          data/roles/{role.folderName}
        </span>
      </header>

      <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="flex min-h-0 flex-1">
        <TabsList className="h-full w-14 shrink-0 flex-col items-stretch justify-start gap-1 rounded-none border-r bg-transparent p-2 sm:w-44">
          <TabsTrigger
            value="status"
            className="w-full justify-start gap-2.5 px-2.5 py-2 text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
          >
            <Activity className="size-4 shrink-0" />
            <span className="hidden sm:inline">运行与状态</span>
          </TabsTrigger>
          <TabsTrigger
            value="diary"
            className="w-full justify-start gap-2.5 px-2.5 py-2 text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
          >
            <BookOpen className="size-4 shrink-0" />
            <span className="hidden sm:inline">日记本</span>
          </TabsTrigger>
          <TabsTrigger
            value="trace"
            className="w-full justify-start gap-2.5 px-2.5 py-2 text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
          >
            <Compass className="size-4 shrink-0" />
            <span className="hidden sm:inline">行为轨迹</span>
          </TabsTrigger>
          <TabsTrigger
            value="persona"
            className="w-full justify-start gap-2.5 px-2.5 py-2 text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
          >
            <UserRound className="size-4 shrink-0" />
            <span className="hidden sm:inline">人设与口癖</span>
          </TabsTrigger>
          <TabsTrigger
            value="memory"
            className="w-full justify-start gap-2.5 px-2.5 py-2 text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
          >
            <Brain className="size-4 shrink-0" />
            <span className="hidden sm:inline">长期记忆</span>
          </TabsTrigger>
          <TabsTrigger
            value="transfer"
            className="w-full justify-start gap-2.5 px-2.5 py-2 text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
          >
            <Palette className="size-4 shrink-0" />
            <span className="hidden sm:inline">外观与迁移</span>
          </TabsTrigger>
        </TabsList>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[780px] px-6 py-6">
            <TabsContent value="status" className="mt-0">
              <RoleStatusPanel key={role.id} role={role} />
            </TabsContent>
            <TabsContent value="diary" className="mt-0">
              <RoleDiaryPanel key={role.id} role={role} />
            </TabsContent>
            <TabsContent value="trace" className="mt-0">
              <RoleTracePanel key={role.id} role={role} />
            </TabsContent>
            <TabsContent value="persona" className="mt-0">
              <PersonaPanel key={role.id} role={role} onSaved={() => void refreshRole()} />
            </TabsContent>
            <TabsContent value="memory" className="mt-0">
              <MemorySettings key={role.id} roleId={role.id} />
            </TabsContent>
            <TabsContent value="transfer" className="mt-0">
              <RoleTransferPanel
                key={role.id}
                role={role}
                avatarSrc={avatarSrc}
                onRequestAvatarSrc={onRequestAvatarSrc}
                onAvatarSaved={() => void refreshRole()}
                onDeleted={onRoleDeleted}
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
