export interface McpServerManifest {
  id: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  timeoutMs?: number
}

export interface WidgetManifest {
  id: string
  entry: string
  title: string
  placement: 'sidebar' | 'float'
}

export interface PluginManifest {
  formatVersion: number
  id: string
  name: string
  version: string
  author?: string
  description?: string
  permissions?: string[]
  contributions?: {
    widgets?: WidgetManifest[]
    mcpServers?: McpServerManifest[]
  }
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  enabled: boolean
  status: 'disabled' | 'enabled' | 'error'
  errorMessage?: string
  mcpTools: string[]
  widgetCount: number
}
