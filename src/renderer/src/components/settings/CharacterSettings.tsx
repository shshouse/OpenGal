/**
 * 角色管理面板：列出 mods/role-card 下所有角色卡，支持切换激活角色。
 *
 * 当前阶段（M2）只读：
 * - 列出所有 character.json 解析成功的卡
 * - 单选切换激活角色
 * - 展示角色 persona / voice provider / llm provider 简要
 *
 * 后续阶段：
 * - 导入 .char 包（解压到 mods/role-card/）
 * - 在线编辑 persona / voice 配置
 * - 角色间快速切换的全局快捷键
 */

import * as React from 'react'
import { Users, RefreshCw, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCharacterStore } from '@/features/character/characterStore'
import { cn } from '@/lib/utils'

export function CharacterSettings() {
  const list = useCharacterStore((s) => s.list)
  const activeId = useCharacterStore((s) => s.activeId)
  const loading = useCharacterStore((s) => s.loading)
  const error = useCharacterStore((s) => s.error)
  const loadCharacters = useCharacterStore((s) => s.loadCharacters)
  const setActive = useCharacterStore((s) => s.setActive)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4" /> 角色管理
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadCharacters(activeId)}
          disabled={loading}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          重新扫描
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {list.length === 0 && !loading && (
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          mods/role-card 下未发现可用角色卡
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {list.map((card) => {
          const active = card.id === activeId
          return (
            <button
              key={card.id}
              onClick={() => void setActive(card.id)}
              className={cn(
                'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                active
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-primary/40 hover:bg-accent/30',
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span
                  className="truncate text-sm font-medium"
                  style={card.color ? { color: card.color } : undefined}
                >
                  {card.displayName ?? card.name}
                </span>
                {active && <Check className="size-3.5 shrink-0 text-primary" />}
              </div>
              <span className="line-clamp-2 text-[11px] text-muted-foreground">
                {card.persona.description || card.persona.personality}
              </span>
              <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                <span className="rounded-full border px-1.5 py-px">
                  TTS: {card.voice?.provider ?? '—'}
                </span>
                {card.llm?.provider && (
                  <span className="rounded-full border px-1.5 py-px">
                    LLM: {card.llm.provider}
                  </span>
                )}
                {card.windowMode && (
                  <span className="rounded-full border px-1.5 py-px">
                    {card.windowMode}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
