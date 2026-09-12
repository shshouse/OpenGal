import * as React from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Users, Monitor, Sparkles, Volume2, Mic, ScrollText, Puzzle, Brain, Gamepad2 } from 'lucide-react'
import { CharacterSettings } from './CharacterSettings'
import { CharacterDisplaySettings } from './CharacterDisplaySettings'
import { SettingsDialog } from './SettingsDialog'
import { TTSSettings } from './TTSSettings'
import { ASRSettings } from './ASRSettings'
import { LogsView } from './LogsView'
import { PluginSettings } from './PluginSettings'
import { MemorySettings } from './MemorySettings'
import { EnvironmentSettings } from './EnvironmentSettings'
import type { AppConfig, Live2DModelConfig } from '@shared/types'

interface SettingsCenterProps {
  config: AppConfig | null
  model: Live2DModelConfig | null
  onSave: (next: Partial<AppConfig>) => Promise<void>
}

const SECTIONS = [
  { value: 'character', label: '角色', icon: Users, description: '浏览并切换 mods/role-card 下的角色卡' },
  { value: 'display', label: '显示', icon: Monitor, description: '人物缩放、位置与显示开关' },
  { value: 'llm', label: '模型', icon: Sparkles, description: '管理对话模型、API Key 与热切换' },
  { value: 'tts', label: 'TTS', icon: Volume2, description: 'GPT-SoVITS 语音合成服务与参考音频参数' },
  { value: 'asr', label: 'STT', icon: Mic, description: '语音识别（ASR）参数' },
  { value: 'plugins', label: '插件', icon: Puzzle, description: '管理工具与界面扩展插件' },
  { value: 'memory', label: '记忆', icon: Brain, description: '查看与管理角色记忆' },
  { value: 'environment', label: '环境', icon: Gamepad2, description: '游戏模式、联网搜索与文件搜索目录' },
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

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
          <TabsContent value="plugins" className="mt-0">
            <PluginSettings />
          </TabsContent>
          <TabsContent value="memory" className="mt-0">
            <MemorySettings />
          </TabsContent>
          <TabsContent value="environment" className="mt-0">
            <EnvironmentSettings config={config} onSave={onSave} />
          </TabsContent>
          <TabsContent value="logs" className="mt-0">
            <LogsView />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  )
}
