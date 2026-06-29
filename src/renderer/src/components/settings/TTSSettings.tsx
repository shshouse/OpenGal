import * as React from 'react'
import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { AppConfig, TTSConfig } from '@shared/types'

const REF_LANG_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'zh', label: '中英混合' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日英混合' },
  { value: 'yue', label: '粤英混合' },
  { value: 'ko', label: '韩英混合' },
  { value: 'all_zh', label: '全部按中文' },
  { value: 'all_ja', label: '全部按日文' },
  { value: 'all_yue', label: '全部按粤语' },
  { value: 'all_ko', label: '全部按韩文' }
]

const OUT_LANG_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: '多语种混合' },
  { value: 'auto_yue', label: '多语种混合(粤语)' },
  ...REF_LANG_OPTIONS
]

interface TTSSettingsProps {
  config: AppConfig | null
  onSave: (next: Partial<AppConfig>) => Promise<void>
}

export function TTSSettings({ config, onSave }: TTSSettingsProps) {
  const [form, setForm] = React.useState<TTSConfig>({
    enabled: false,
    baseURL: 'http://127.0.0.1:9880',
    gptModelRelPath: '',
    sovitsModelRelPath: '',
    referenceAudioRelPath: '',
    referenceText: '',
    referenceLanguage: 'en',
    outputLanguage: 'auto',
    speedFactor: 1,
    textSplitMethod: 'cut5'
  })
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)
  const [serverBusy, setServerBusy] = React.useState(false)
  /**
   * 真实健康状态而非仅看 child process pid：
   * - unknown: 还没探测过
   * - stopped: 进程未运行
   * - starting: 进程在但 HTTP 端口还不可达（启动中或已挂死）
   * - ready:   进程在且 HTTP 端口可达
   */
  const [health, setHealth] = React.useState<'unknown' | 'stopped' | 'starting' | 'ready'>(
    'unknown',
  )
  const [healthDetail, setHealthDetail] = React.useState<string | null>(null)
  /** server 进程当前实际监听的端口（启动时绑定的端口），用来检测 baseURL 改了但没重启 */
  const [serverPort, setServerPort] = React.useState<number | null>(null)
  const [logVisible, setLogVisible] = React.useState(false)
  const [logText, setLogText] = React.useState('')

  React.useEffect(() => {
    if (config?.tts) {
      setForm(config.tts)
    }
  }, [config])

  /**
   * 每 3 秒探测一次：进程是否活着（pidAlive）+ HTTP 端口是否可达（portReachable）。
   * 这样可以正确区分「进程在但服务挂了」的状态——只看进程会被误判为运行中。
   * 之前 UI 同时显示「运行中」+「连接成功」却 fetch failed 就是这个误判。
   */
  const probeHealth = React.useCallback(async () => {
    const statusResult = await window.opengal.tts.serverStatus()
    const pidAlive = statusResult.success && statusResult.data?.running === true
    setServerPort(statusResult.success ? statusResult.data?.port ?? null : null)
    if (!pidAlive) {
      setHealth('stopped')
      setHealthDetail(null)
      return
    }
    const pingResult = await window.opengal.tts.ping()
    const portReachable = pingResult.success && pingResult.data?.ok === true
    if (portReachable) {
      setHealth('ready')
      setHealthDetail(null)
    } else {
      setHealth('starting')
      setHealthDetail(pingResult.data?.message || pingResult.error || '端口暂不可达')
    }
  }, [])

  React.useEffect(() => {
    void probeHealth()
    const id = setInterval(probeHealth, 3000)
    return () => clearInterval(id)
  }, [probeHealth])

  const serverRunning = health === 'ready' || health === 'starting'

  /**
   * 检测 baseURL 端口和 server 实际监听端口是否一致。不一致意味着用户改了
   * baseURL 但没有「停止 + 启动」服务让 python 重新 bind——会导致 fetch
   * 永远连到无人监听的端口（控制台报 ECONNREFUSED）。
   */
  const formPort = React.useMemo(() => {
    try {
      return Number(new URL(form.baseURL).port) || 9880
    } catch {
      return null
    }
  }, [form.baseURL])
  const portMismatch =
    serverRunning && serverPort !== null && formPort !== null && formPort !== serverPort

  async function handleStartServer(): Promise<void> {
    setServerBusy(true)
    setStatus('正在启动 GPT-SoVITS 服务(首次启动需要 30-90 秒)...')
    try {
      const r = await window.opengal.tts.serverStart()
      if (!r.success) throw new Error(r.error || 'start failed')
      setStatus(`服务已就绪 (pid=${r.data?.pid})`)
      void probeHealth()
    } catch (err) {
      setStatus(`启动失败: ${(err as Error).message}`)
      void probeHealth()
    } finally {
      setServerBusy(false)
    }
  }

  async function handleStopServer(): Promise<void> {
    setServerBusy(true)
    try {
      await window.opengal.tts.serverStop()
      setStatus('服务已停止')
      void probeHealth()
    } finally {
      setServerBusy(false)
    }
  }

  async function handleViewLog(): Promise<void> {
    const r = await window.opengal.tts.serverLog()
    setLogText(r.success ? r.data || '(空)' : `读取日志失败: ${r.error || 'unknown'}`)
    setLogVisible(true)
  }

  function update<K extends keyof TTSConfig>(key: K, value: TTSConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setStatus(null)
    try {
      await onSave({ tts: form })
      await window.opengal.tts.reset()
      setStatus('已保存')
    } catch (error) {
      setStatus(`保存失败: ${(error as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handlePing(): Promise<void> {
    setStatus('正在测试连接...')
    const result = await window.opengal.tts.ping()
    if (result.success && result.data?.ok) {
      setStatus(`连接成功 (${result.data.message || 'OK'})`)
    } else {
      setStatus(`连接失败: ${result.data?.message || result.error || 'unknown'}`)
    }
    void probeHealth()
  }

  async function handleTest(): Promise<void> {
    setStatus('正在合成...')
    try {
      const result = await window.opengal.tts.speak({ text: 'Hello! This is a test.' })
      if (!result.success || !result.data) {
        throw new Error(result.error || 'TTS failed')
      }
      const { audioBase64, mimeType } = result.data
      const audio = new Audio(`data:${mimeType};base64,${audioBase64}`)
      await audio.play()
      setStatus('测试成功')
    } catch (error) {
      setStatus(`测试失败: ${(error as Error).message}`)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Volume2 className="size-4" /> TTS 设置 (GPT-SoVITS)
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-muted-foreground">启用</label>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => update('enabled', e.target.checked)}
          className="size-4"
        />
      </div>

      <label className="text-xs font-medium text-muted-foreground">后端地址</label>
      <Input
        value={form.baseURL}
        onChange={(e) => update('baseURL', e.target.value)}
        placeholder="http://127.0.0.1:9880"
      />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">GPT 权重 (相对路径)</label>
          <Input
            value={form.gptModelRelPath}
            onChange={(e) => update('gptModelRelPath', e.target.value)}
            placeholder="GPT/Neuro-e24.ckpt"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">SoVITS 权重 (相对路径)</label>
          <Input
            value={form.sovitsModelRelPath}
            onChange={(e) => update('sovitsModelRelPath', e.target.value)}
            placeholder="SoVITS/Neuro_e8_s7056.pth"
          />
        </div>
      </div>

      <label className="text-xs font-medium text-muted-foreground">参考音频 (相对路径)</label>
      <Input
        value={form.referenceAudioRelPath}
        onChange={(e) => update('referenceAudioRelPath', e.target.value)}
        placeholder="reference/ref.wav"
      />

      <label className="text-xs font-medium text-muted-foreground">参考文本</label>
      <Input
        value={form.referenceText}
        onChange={(e) => update('referenceText', e.target.value)}
        placeholder="Hello, I am Neuro!"
      />

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">参考语言</label>
          <Select
            value={form.referenceLanguage}
            onValueChange={(v) => update('referenceLanguage', v as TTSConfig['referenceLanguage'])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REF_LANG_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">输出语言</label>
          <Select
            value={form.outputLanguage}
            onValueChange={(v) => update('outputLanguage', v as TTSConfig['outputLanguage'])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUT_LANG_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">语速</label>
          <Input
            type="number"
            step={0.1}
            min={0.5}
            max={2}
            value={form.speedFactor}
            onChange={(e) => update('speedFactor', parseFloat(e.target.value) || 1)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t flex-wrap">
        <span className="text-xs font-medium">
          <span className="text-muted-foreground">GPT-SoVITS 服务: </span>
          {health === 'unknown' && <span className="text-muted-foreground">检测中...</span>}
          {health === 'stopped' && <span className="text-muted-foreground">未运行</span>}
          {health === 'starting' && (
            <span className="text-amber-600 dark:text-amber-400">进程在但端口不可达</span>
          )}
          {health === 'ready' && (
            <span className="text-emerald-600 dark:text-emerald-400">运行中（已就绪）</span>
          )}
        </span>
        {!serverRunning ? (
          <Button onClick={handleStartServer} disabled={serverBusy} size="sm">
            {serverBusy ? '启动中...' : '启动服务'}
          </Button>
        ) : (
          <Button onClick={handleStopServer} disabled={serverBusy} variant="outline" size="sm">
            停止服务
          </Button>
        )}
        <Button onClick={handleViewLog} variant="ghost" size="sm">
          查看日志
        </Button>
        {serverPort !== null && (
          <span className="text-xs text-muted-foreground">监听端口: {serverPort}</span>
        )}
        {health === 'starting' && healthDetail && (
          <span className="text-xs text-amber-600 dark:text-amber-400 break-all">
            {healthDetail}
          </span>
        )}
      </div>

      {portMismatch && (
        <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-3 py-2">
          后端地址端口（{formPort}）与服务实际监听端口（{serverPort}）不一致。改 baseURL 后请「停止服务」再「启动服务」让 python 重新绑定新端口，否则合成会一直连接被拒。
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? '保存中...' : '保存'}
        </Button>
        <Button onClick={handlePing} variant="outline" size="sm">
          测试连接
        </Button>
        <Button onClick={handleTest} variant="outline" size="sm" disabled={!form.enabled}>
          试听
        </Button>
        {status && <span className="text-xs text-muted-foreground break-all">{status}</span>}
      </div>

      {logVisible && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col border">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <span className="text-sm font-semibold">GPT-SoVITS 服务日志</span>
              <Button size="sm" variant="ghost" onClick={() => setLogVisible(false)}>
                关闭
              </Button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono whitespace-pre-wrap break-all">
              {logText || '(暂无日志)'}
            </pre>
            <div className="px-4 py-2 border-t flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={handleViewLog}>
                刷新
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
