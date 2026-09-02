import * as React from 'react'
import { Button } from '@/components/ui/button'
import type { PluginInfo } from '@shared/types'

export function PluginSettings() {
  const [plugins, setPlugins] = React.useState<PluginInfo[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    const res = await window.opengal.plugins.list()
    if (res.success && res.data) {
      setPlugins(res.data)
      setError(null)
    } else {
      setError(res.error ?? '读取插件列表失败')
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const toggle = async (id: string, next: boolean) => {
    setBusyId(id)
    const res = await window.opengal.plugins.setEnabled(id, next)
    if (res.success && res.data) {
      setPlugins(res.data)
      setError(null)
    } else {
      setError(res.error ?? '操作失败')
      await refresh()
    }
    setBusyId(null)
  }

  const rescan = async () => {
    setBusyId('__rescan')
    const res = await window.opengal.plugins.rescan()
    if (res.success && res.data) {
      setPlugins(res.data)
      setError(null)
    } else {
      setError(res.error ?? '扫描失败')
    }
    setBusyId(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          插件目录：data/plugins/，放入后点重新扫描即可发现
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busyId !== null}
          onClick={() => void rescan()}
        >
          重新扫描
        </Button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {plugins !== null && plugins.length === 0 && (
        <p className="text-xs text-muted-foreground">
          还没有插件。把插件目录（含 manifest.json）放进 data/plugins/ 后重新扫描。
        </p>
      )}

      {plugins?.map((p) => (
        <div key={p.id} className="rounded-md border p-3 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium truncate">
              {p.name} <span className="text-xs text-muted-foreground">v{p.version}</span>
            </div>
            <Button
              type="button"
              variant={p.enabled ? 'outline' : 'default'}
              size="sm"
              disabled={busyId !== null}
              onClick={() => void toggle(p.id, !p.enabled)}
            >
              {busyId === p.id ? '处理中...' : p.enabled ? '禁用' : '启用'}
            </Button>
          </div>
          {p.author && <p className="text-xs text-muted-foreground">作者：{p.author}</p>}
          {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
          <p className="text-xs text-muted-foreground">
            状态：
            {p.status === 'enabled'
              ? `已启用${p.mcpTools.length > 0 ? `（${p.mcpTools.length} 个工具）` : ''}`
              : p.status === 'error'
                ? '错误'
                : '已禁用'}
            {p.widgetCount > 0 ? `，含 ${p.widgetCount} 个控件（待 P2 支持）` : ''}
          </p>
          {p.errorMessage && <p className="text-xs text-red-500">{p.errorMessage}</p>}
        </div>
      ))}
    </div>
  )
}
