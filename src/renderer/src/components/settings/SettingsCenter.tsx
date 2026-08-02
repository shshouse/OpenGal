/**
 * 设置中心：把零散的设置面板统一组织进 Tabs。
 *
 * 当前分页：
 * - 角色：列出 mod/role-card 下的角色卡，切换激活
 * - LLM：全局供应商 / Base URL / API Key / 模型名
 * - TTS：GPT-SoVITS 服务和参考音频参数（沿用现有 TTSSettings）
 * - STT：ASR 设置
 * - 日志：运行日志查看（复用 LogsPanel 的数据，移动端内嵌）
 *
 * 后续可加：Live2D / 主题 / 快捷键 / 数据导入导出
 */

import * as React from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

export function SettingsCenter({ config, model, onSave }: SettingsCenterProps) {
  return (
    <Tabs defaultValue="character" className="w-full">
      <TabsList>
        <TabsTrigger value="character">角色</TabsTrigger>
        <TabsTrigger value="display">显示</TabsTrigger>
        <TabsTrigger value="llm">LLM</TabsTrigger>
        <TabsTrigger value="tts">TTS</TabsTrigger>
        <TabsTrigger value="asr">STT</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="character" className="pt-2">
        <CharacterSettings />
      </TabsContent>
      <TabsContent value="display" className="pt-2">
        <CharacterDisplaySettings config={config} model={model} onSave={onSave} />
      </TabsContent>
      <TabsContent value="llm" className="pt-2">
        <SettingsDialog config={config} onSave={onSave} />
      </TabsContent>
      <TabsContent value="tts" className="pt-2">
        <TTSSettings config={config} onSave={onSave} />
      </TabsContent>
      <TabsContent value="asr" className="pt-2">
        <ASRSettings config={config} onSave={onSave} />
      </TabsContent>
      <TabsContent value="logs" className="pt-2">
        <LogsView />
      </TabsContent>
    </Tabs>
  )
}
