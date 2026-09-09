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
import { useCharacterStore } from '@/features/character/characterStore'

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

const CARD_FIELD_MAP: Partial<Record<keyof TTSConfig, string>> = {
  baseURL: 'baseURL',
  gptModelRelPath: 'gptModel',
  sovitsModelRelPath: 'sovitsModel',
  characterName: 'characterName',
  onnxModelDir: 'onnxModelDir',
  referenceAudioRelPath: 'referenceAudio',
  referenceText: 'referenceText',
  referenceLanguage: 'referenceLanguage',
  outputLanguage: 'outputLanguage',
  speedFactor: 'speedFactor',
  textSplitMethod: 'textSplitMethod'
}

function CardTag() {
  return (
    <span className="ml-1 rounded bg-primary/15 px-1 py-0.5 text-[10px] text-primary">角色卡</span>
  )
}

interface TTSSettingsProps {
  config: AppConfig | null
  onSave: (next: Partial<AppConfig>) => Promise<void>
}

export function TTSSettings({ config, onSave }: TTSSettingsProps) {
  const [form, setForm] = React.useState<TTSConfig>({
    enabled: false,
    provider: 'gpt-sovits',
    baseURL: 'http://127.0.0.1:39880',
    gptModelRelPath: '',
    sovitsModelRelPath: '',
    characterName: '',
    onnxModelDir: '',
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
  const [health, setHealth] = React.useState<'unknown' | 'stopped' | 'starting' | 'ready'>(
    'unknown',
  )
  const [healthDetail, setHealthDetail] = React.useState<string | null>(null)
  const [serverPort, setServerPort] = React.useState<number | null>(null)
  const [logVisible, setLogVisible] = React.useState(false)
  const [logText, setLogText] = React.useState('')

  React.useEffect(() => {
    if (config?.tts) {
      setForm(config.tts)
    }
  }, [config])

  const activeCharacter = useCharacterStore((s) => s.list.find((c) => c.id === s.activeId))
  const activeVoiceRef = activeCharacter?.voice?.configRef
  const [cardVoice, setCardVoice] = React.useState<Record<string, unknown> | null>(null)

  React.useEffect(() => {
    if (!activeCharacter?.id) {
      setCardVoice(null)
      return
    }
    let cancelled = false
    void window.opengal.character
      .voiceConfig(activeCharacter.id)
      .then((res) => {
        if (!cancelled) setCardVoice(res.success && res.data ? res.data : null)
      })
      .catch(() => {
        if (!cancelled) setCardVoice(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeCharacter?.id, activeVoiceRef])

  const fromCard = React.useCallback(
    (key: keyof TTSConfig): boolean => {
      if (!cardVoice) return false
      const cardKey = CARD_FIELD_MAP[key]
      if (!cardKey) return false
      const v = cardVoice[cardKey]
      return v !== undefined && v !== null && v !== ''
    },
    [cardVoice],
  )

  const effective = React.useCallback(
    (key: keyof TTSConfig): string | number => {
      const cardKey = CARD_FIELD_MAP[key]
      if (cardVoice && cardKey && fromCard(key)) {
        return cardVoice[cardKey] as string | number
      }
      return form[key] as string | number
    },
    [cardVoice, form, fromCard],
  )

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

  const formPort = React.useMemo(() => {
    try {
      return Number(new URL(form.baseURL).port) || 39880
    } catch {
      return null
    }
  }, [form.baseURL])
  const portMismatch =
    serverRunning && serverPort !== null && formPort !== null && formPort !== serverPort

  async function handleStartServer(): Promise<void> {
    setServerBusy(true)
    setStatus('正在启动 TTS 服务(首次启动需要 30-90 秒)...')
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
        <Volume2 className="size-4" /> TTS 设置
      </div>

      {activeCharacter && cardVoice && (
        <div className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2">
          当前角色「{activeCharacter.displayName ?? activeCharacter.name}」的语音由角色卡提供
          （{activeCharacter.voice?.configRef}）。带「角色卡」标记的字段以卡为准（灰显不可编辑，
          修改需编辑卡内配置）；其余字段为全局默认值。
        </div>
      )}
      {activeCharacter?.voice?.configRef && !cardVoice && (
        <div className="text-xs text-amber-600 dark:text-amber-400 bg-muted/30 rounded px-3 py-2">
          当前角色的语音配置（{activeCharacter.voice.configRef}）读取失败：合成时将使用下方全局值
          或无参考文本模式。
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-muted-foreground">启用</label>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => update('enabled', e.target.checked)}
          className="size-4"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">
          引擎
          {activeCharacter?.voice?.provider && (
            <span className="ml-1 rounded bg-primary/15 px-1 py-0.5 text-[10px] text-primary">
              角色卡当前指定: {activeCharacter.voice.provider}（仅提示，可修改）
            </span>
          )}
        </label>
        <Select
          value={form.provider}
          onValueChange={(v) => update('provider', v as TTSConfig['provider'])}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gpt-sovits">GPT-SoVITS (PyTorch)</SelectItem>
            <SelectItem value="genie">Genie-TTS (ONNX)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.provider === 'genie' && (
        <div className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2">
          Genie 需先转换模型为 ONNX 格式（src/scripts/tts/convert_to_onnx.py），并启动 Genie API 服务（src/scripts/tts/start_genie_tts.py）。
        </div>
      )}

      <label className="text-xs font-medium text-muted-foreground">
        后端地址
        {fromCard('baseURL') && <CardTag />}
      </label>
      <Input
        value={String(effective('baseURL'))}
        onChange={(e) => update('baseURL', e.target.value)}
        disabled={fromCard('baseURL')}
        placeholder={form.provider === 'genie' ? 'http://127.0.0.1:8000' : 'http://127.0.0.1:39880'}
      />

      {form.provider === 'gpt-sovits' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                GPT 权重 (相对路径)
                {fromCard('gptModelRelPath') && <CardTag />}
              </label>
              <Input
                value={String(effective('gptModelRelPath'))}
                onChange={(e) => update('gptModelRelPath', e.target.value)}
                disabled={fromCard('gptModelRelPath')}
                placeholder="GPT/your-model.ckpt"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                SoVITS 权重 (相对路径)
                {fromCard('sovitsModelRelPath') && <CardTag />}
              </label>
              <Input
                value={String(effective('sovitsModelRelPath'))}
                onChange={(e) => update('sovitsModelRelPath', e.target.value)}
                disabled={fromCard('sovitsModelRelPath')}
                placeholder="SoVITS/your-model.pth"
              />
            </div>
          </div>
        </>
      )}

      {form.provider === 'genie' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                角色名
                {fromCard('characterName') && <CardTag />}
              </label>
              <Input
                value={String(effective('characterName'))}
                onChange={(e) => update('characterName', e.target.value)}
                disabled={fromCard('characterName')}
                placeholder="character-id"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                ONNX 模型目录 (相对路径)
                {fromCard('onnxModelDir') && <CardTag />}
              </label>
              <Input
                value={String(effective('onnxModelDir'))}
                onChange={(e) => update('onnxModelDir', e.target.value)}
                disabled={fromCard('onnxModelDir')}
                placeholder="genie-onnx/character-id"
              />
            </div>
          </div>
        </>
      )}

      <label className="text-xs font-medium text-muted-foreground">
        参考音频 (相对路径)
        {fromCard('referenceAudioRelPath') && <CardTag />}
      </label>
      <Input
        value={String(effective('referenceAudioRelPath'))}
        onChange={(e) => update('referenceAudioRelPath', e.target.value)}
        disabled={fromCard('referenceAudioRelPath')}
        placeholder="reference/ref.wav"
      />

      <label className="text-xs font-medium text-muted-foreground">
        参考文本
        {fromCard('referenceText') && <CardTag />}
      </label>
      <Input
        value={String(effective('referenceText'))}
        onChange={(e) => update('referenceText', e.target.value)}
        disabled={fromCard('referenceText')}
        placeholder="Hello! （留空 = 无参考文本模式，仅 GPT-SoVITS 支持）"
      />

      {form.provider === 'gpt-sovits' && (
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              参考语言
              {fromCard('referenceLanguage') && <CardTag />}
            </label>
            <Select
              value={String(effective('referenceLanguage'))}
              onValueChange={(v) => update('referenceLanguage', v as TTSConfig['referenceLanguage'])}
              disabled={fromCard('referenceLanguage')}
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
            <label className="text-xs font-medium text-muted-foreground">
              输出语言
              {fromCard('outputLanguage') && <CardTag />}
            </label>
            <Select
              value={String(effective('outputLanguage'))}
              onValueChange={(v) => update('outputLanguage', v as TTSConfig['outputLanguage'])}
              disabled={fromCard('outputLanguage')}
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
            <label className="text-xs font-medium text-muted-foreground">
              语速
              {fromCard('speedFactor') && <CardTag />}
            </label>
            <Input
              type="number"
              step={0.1}
              min={0.5}
              max={2}
              value={Number(effective('speedFactor'))}
              onChange={(e) => update('speedFactor', parseFloat(e.target.value) || 1)}
              disabled={fromCard('speedFactor')}
            />
          </div>
        </div>
      )}

      {form.provider === 'genie' && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            参考语言
            {fromCard('referenceLanguage') && <CardTag />}
          </label>
          <Select
            value={String(effective('referenceLanguage'))}
            onValueChange={(v) => update('referenceLanguage', v as TTSConfig['referenceLanguage'])}
            disabled={fromCard('referenceLanguage')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh">中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ja">日本語</SelectItem>
              <SelectItem value="ko">한국어</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 border-t flex-wrap">
        <span className="text-xs font-medium">
          <span className="text-muted-foreground">TTS 服务: </span>
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
              <span className="text-sm font-semibold">TTS 服务日志</span>
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
