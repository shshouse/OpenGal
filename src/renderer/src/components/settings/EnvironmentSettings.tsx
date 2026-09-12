import * as React from 'react'
import { Gamepad2, Plus, Trash2, Globe, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AppConfig } from '@shared/types'

interface EnvironmentSettingsProps {
  config: AppConfig | null
  onSave: (next: Partial<AppConfig>) => Promise<void>
}

export function EnvironmentSettings({ config, onSave }: EnvironmentSettingsProps) {
  const [gameEnabled, setGameEnabled] = React.useState(true)
  const [games, setGames] = React.useState<string[]>([])
  const [newGame, setNewGame] = React.useState('')
  const [provider, setProvider] = React.useState<'bing' | 'tavily'>('bing')
  const [tavilyKey, setTavilyKey] = React.useState('')
  const [fileDirs, setFileDirs] = React.useState<string[]>([])
  const [newDir, setNewDir] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!config) return
    setGameEnabled(config.gameMode.enabled)
    setGames(config.gameMode.games)
    setProvider(config.tools.webSearch.provider)
    setTavilyKey(config.tools.webSearch.tavilyKey)
    setFileDirs(config.tools.fileSearchDirs)
  }, [config])

  async function handleSave(): Promise<void> {
    setSaving(true)
    setStatus(null)
    try {
      await onSave({
        gameMode: { enabled: gameEnabled, games: games.map((g) => g.trim()).filter(Boolean) },
        tools: {
          webSearch: { provider, tavilyKey: tavilyKey.trim() },
          fileSearchDirs: fileDirs.map((d) => d.trim()).filter(Boolean),
        },
      })
      setStatus('已保存')
    } catch (err) {
      setStatus(`保存失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Gamepad2 className="size-4" /> 游戏模式
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">启用</label>
          <input
            type="checkbox"
            checked={gameEnabled}
            onChange={(e) => setGameEnabled(e.target.checked)}
            className="size-4"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          匹配规则：进程名或窗口标题包含关键词即判定为游戏。游戏运行时角色知道你在玩什么、回复更简短、语音响应冷却加倍。
        </p>
        <div className="flex gap-2">
          <Input
            value={newGame}
            onChange={(e) => setNewGame(e.target.value)}
            placeholder="游戏关键词，如 endfield、原神（进程名或窗口标题包含即可）"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newGame.trim()) {
                setGames((prev) => [...new Set([...prev, newGame.trim()])])
                setNewGame('')
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!newGame.trim()) return
              setGames((prev) => [...new Set([...prev, newGame.trim()])])
              setNewGame('')
            }}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        <div className="rounded-lg border">
          {games.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              暂无游戏，添加关键词后生效
            </div>
          ) : (
            games.map((g) => (
              <div
                key={g}
                className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
              >
                <span className="flex-1 truncate">{g}</span>
                <button
                  type="button"
                  title="删除"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setGames((prev) => prev.filter((x) => x !== g))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Globe className="size-4" /> 联网搜索
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">搜索源</label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as 'bing' | 'tavily')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bing">必应（免配置）</SelectItem>
                <SelectItem value="tavily">Tavily API（质量更高）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Tavily API Key</label>
            <Input
              value={tavilyKey}
              onChange={(e) => setTavilyKey(e.target.value)}
              placeholder={provider === 'tavily' ? '必填，tavily.com 免费注册' : '切到 Tavily 后填写'}
              disabled={provider !== 'tavily'}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FolderOpen className="size-4" /> 文件搜索目录
        </div>
        <p className="text-xs text-muted-foreground">
          角色的 local_file_search 工具默认搜索文档/下载/桌面，这里可追加其他目录（只搜文件名，不读内容）。
        </p>
        <div className="flex gap-2">
          <Input
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            placeholder="绝对路径，如 D:\MyProjects"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newDir.trim()) {
                setFileDirs((prev) => [...new Set([...prev, newDir.trim()])])
                setNewDir('')
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!newDir.trim()) return
              setFileDirs((prev) => [...new Set([...prev, newDir.trim()])])
              setNewDir('')
            }}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        {fileDirs.length > 0 && (
          <div className="rounded-lg border">
            {fileDirs.map((d) => (
              <div
                key={d}
                className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
              >
                <span className="flex-1 truncate">{d}</span>
                <button
                  type="button"
                  title="删除"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setFileDirs((prev) => prev.filter((x) => x !== d))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t pt-4">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? '保存中...' : '保存'}
        </Button>
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </div>
    </div>
  )
}
