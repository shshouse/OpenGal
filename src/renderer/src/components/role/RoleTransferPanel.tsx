import * as React from 'react'
import { FolderOutput, Trash2 } from 'lucide-react'
import type { RoleCardEntry } from '@shared/types'
import { Button } from '@/components/ui/button'
import { useRoleStore } from '@/features/role/roleStore'
import { AppearancePanel } from './AppearancePanel'

interface Props {
  role: RoleCardEntry
  onDeleted: () => void
  onOpenDisplaySettings: () => void
  onOpenTtsSettings: () => void
  onOpenModelSettings: () => void
  avatarSrc?: string | null
  onRequestAvatarSrc?: () => void
  onAvatarSaved?: () => void
}

export function RoleTransferPanel({
  role,
  onDeleted,
  onOpenDisplaySettings,
  onOpenTtsSettings,
  onOpenModelSettings,
  avatarSrc,
  onRequestAvatarSrc,
  onAvatarSaved,
}: Props): React.JSX.Element {
  const [notice, setNotice] = React.useState('')
  const [error, setError] = React.useState('')
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  async function handleExportFolder(): Promise<void> {
    setError('')
    setNotice('')
    const res = await window.opengal.role.exportFolder(role.id)
    if (!res.success) {
      setError(res.error ?? '导出角色目录失败')
      return
    }
    if (res.data) {
      setNotice(`已导出完整角色目录：${res.data}`)
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
      <AppearancePanel
        role={role}
        avatarSrc={avatarSrc}
        onRequestAvatarSrc={onRequestAvatarSrc}
        onAvatarSaved={onAvatarSaved}
        onOpenDisplaySettings={onOpenDisplaySettings}
        onOpenTtsSettings={onOpenTtsSettings}
        onOpenModelSettings={onOpenModelSettings}
      />

      <section className="flex flex-col gap-3 border-t pt-6">
        <div>
          <h2 className="text-sm font-semibold">角色目录迁移与管理</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            导出的目录包含完整人设、对话原文、译文、长期记忆、日记与立绘图片；复制到其他电脑的 data/roles 即可直接延续陪伴。若在同一台电脑上手动复制一份目录，OpenGal 会自动分配独立编号，不会发生冲突。
          </p>
        </div>

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

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">
            当前所在位置：data/roles/{role.folderName}
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
        </div>
      </section>
    </div>
  )
}
