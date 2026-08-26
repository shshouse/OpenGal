/**
 * 设置中心：左侧导航栏 + 右侧内容区（TraeCode 风格布局）。
 *
 * 当前分页：
 * - 角色：列出 mods/role-card 下的角色卡，切换激活
 * - 显示：人物缩放 / 位置 / 显示开关
 * - LLM：全局供应商 / Base URL / API Key / 模型名
 * - TTS：GPT-SoVITS 服务和参考音频参数（沿用现有 TTSSettings）
 * - STT：ASR 设置
 * - 日志：运行日志查看（复用 LogsPanel 的数据，移动端内嵌）
 *
 * 布局说明：根节点要求父级给出确定高度（flex-1 + min-h-0），
 * 左栏导航不滚动，右栏头部固定、内容区独立滚动。
 * 窄屏（移动端）左栏收起为纯图标。
 *
 * 后续可加：Live2D / 主题 / 快捷键 / 数据导入导出
 */

import * as React from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Users, Monitor, Sparkles, Volume2, Mic, ScrollText } from 'lucide-react'
import { CharacterSettings } from './CharacterSettings'
import { CharacterDisplaySettings } from './CharacterDisplaySettings'
import { SettingsDialog } from './SettingsDialog'
import { TTSSettings } from './TTSSettings'
import { ASRSettings } from './ASRSettings'
import { LogsView } from './LogsView'
import type { AppConfig, Live2DModelConfig } from '@shared/types'

interface SettingsCenterProps {
  config: AppConfig | null
  model: Live2DModelConfig | null
  onSave: (next: Partial<AppConfig>) => Promise<void>
}

const SECTIONS = [
  { value: 'character', label: '角色', icon: Users, description: '浏览并切换 mods/role-card 下的角色卡' },
  { value: 'display', label: '显示', icon: Monitor, description: '人物缩放、位置与显示开关' },
  { value: 'llm', label: 'LLM', icon: Sparkles, description: '对话模型的供应商、Base URL、API Key 与模型名' },
  { value: 'tts', label: 'TTS', icon: Volume2, description: 'GPT-SoVITS 语音合成服务与参考音频参数' },
  { value: 'asr', label: 'STT', icon: Mic, description: '语音识别（ASR）参数' },
  { value: 'logs', label: '日志', icon: ScrollText, description: '查看运行日志' }
] as const

export function SettingsCenter({ config, model, onSave }: SettingsCenterProps) {
  const [tab, setTab] = React.useState<string>('character')
  const active = SECTIONS.find((s) => s.value === tab) ?? SECTIONS[0]

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      orientation="vertical"
      className="flex h-full min-h-0 w-full"
    >
      {/* 左侧导航栏：窄屏收起为纯图标 */}
      <TabsList className="h-full w-14 shrink-0 flex-col items-stretch justify-start gap-0.5 rounded-none border-r bg-transparent p-2 sm:w-44">
        {SECTIONS.map((s) => (
          <TabsTrigger
            key={s.value}
            value={s.value}
            title={s.label}
            className="w-full justify-start gap-2.5 px-2.5 py-2 text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
          >
            <s.icon className="size-4 shrink-0" />
            <span className="hidden sm:inline">{s.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {/* 右侧：固定头部（标题 + 描述）+ 独立滚动内容区 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b px-4 py-3 sm:px-6">
          <h2 className="text-base font-semibold">{active.label}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{active.description}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          <TabsContent value="character" className="mt-0">
            <CharacterSettings />
          </TabsContent>
          <TabsContent value="display" className="mt-0">
            <CharacterDisplaySettings config={config} model={model} onSave={onSave} />
          </TabsContent>
          <TabsContent value="llm" className="mt-0">
            <SettingsDialog config={config} onSave={onSave} />
          </TabsContent>
          <TabsContent value="tts" className="mt-0">
            <TTSSettings config={config} onSave={onSave} />
          </TabsContent>
          <TabsContent value="asr" className="mt-0">
            <ASRSettings config={config} onSave={onSave} />
          </TabsContent>
          <TabsContent value="logs" className="mt-0">
            <LogsView />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  )
}
