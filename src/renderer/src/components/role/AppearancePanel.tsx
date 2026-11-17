import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RoleCardEntry } from '@shared/types'
import { useRoleStore } from '@/features/role/roleStore'

function modeLabel(mode: RoleCardEntry['performance']['mode']): string {
  if (mode === 'live2d') return 'Live2D'
  if (mode === 'sprite') return '立绘'
  return '自动选择'
}

function engineLabel(engine?: string): string {
  if (engine === 'genie') return 'Genie'
  if (engine === 'gpt-sovits') return 'GPT-SoVITS'
  return '未配置'
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-3 border-b pb-5 last:border-b-0 last:pb-0">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

export function AppearancePanel({
  role,
  onOpenDisplaySettings,
  onOpenTtsSettings,
  onOpenModelSettings,
}: {
  role: RoleCardEntry
  onOpenDisplaySettings: () => void
  onOpenTtsSettings: () => void
  onOpenModelSettings: () => void
}): React.JSX.Element {
  const outfits = role.outfitEntries ?? []
  const chosen = useRoleStore((state) => state.outfits[role.id])
  const setOutfit = useRoleStore((state) => state.setOutfit)
  const currentId = chosen ?? role.performance.defaultOutfit ?? ''

  return (
    <div className="space-y-5">
      <Section title="外观" description="这个角色当前使用的外观和可切换的服装。">
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">形象：{modeLabel(role.performance.mode)}</div>
          {outfits.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {outfits.map((outfit) => (
                <Button
                  key={outfit.id}
                  type="button"
                  size="sm"
                  variant={outfit.id === currentId ? 'default' : 'outline'}
                  onClick={() => setOutfit(role.id, outfit.id)}
                >
                  {outfit.name}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">这个角色只有一套外观。</p>
          )}
        </div>
      </Section>

      <Section title="显示" description="人物缩放和位置只作用于当前对话角色。">
        <Button type="button" variant="outline" size="sm" onClick={onOpenDisplaySettings}>
          打开显示设置
          <ExternalLink className="size-3.5" />
        </Button>
      </Section>

      <Section title="语音" description="语音引擎由全局语音设置决定；角色卡声明自己使用哪种配置。">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">{engineLabel(role.voice?.engine)}</span>
          <Button type="button" variant="outline" size="sm" onClick={onOpenTtsSettings}>
            打开语音设置
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </Section>

      <Section title="模型" description="角色可以单独指定对话模型；没有指定时跟随全局模型。">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">
            {role.llm?.modelName ?? role.llm?.provider ?? '跟随全局模型'}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onOpenModelSettings}>
            打开模型设置
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </Section>
    </div>
  )
}
