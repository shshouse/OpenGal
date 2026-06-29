/**
 * 工具设置面板：配置和风天气 API key 等。
 *
 * 工具执行器注册在主进程 `services/tools/` 下，工具定义（schema）随每次 LLM 请求
 * 一起发给模型；用户在这里填的 key 会被工具实现函数读取。
 */

import * as React from 'react'

interface ToolsSettingsProps {
  config: unknown
  onSave: (next: Record<string, unknown>) => Promise<void>
}

export function ToolsSettings(_props: ToolsSettingsProps): React.ReactElement | null {
  return null
}
