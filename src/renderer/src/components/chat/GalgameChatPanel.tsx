import * as React from 'react'
import { Cat, Eye, EyeOff, ImagePlus, Info, Moon, Pencil, Play, Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/features/chat/chatStore'
import { useChatPipeline } from '@/features/pipeline/useChatPipeline'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import { getLive2DModel } from '@/features/live2d/live2dBus'
import { useASRStore, setASRFinalCallback } from '@/features/asr/asrStore'
import { offerUtterance, setDirectorDispatch } from '@/features/director/directorWorker'
import { isRoleRunning } from '@shared/role/runtime'
import { useRoleRuntimeStore } from '@/features/role/roleRuntimeStore'
import { useRoleStore } from '@/features/role/roleStore'
import { useStartupStore } from '@/features/startup/startupStore'
import { consumeVoiceInterruption } from '@/features/pipeline/bargeIn'
import { MicButton } from './MicButton'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import { usePendingImages, PendingImagesBar } from './imageAttachments'
import { ChatThread } from './ChatThread'

const COMPOSITION_GUARD_MS = 500

interface Props {
  stage: React.ReactNode
  avatarUrl?: string | null
  onOpenDetails: () => void
  onOpenRoleSettings: () => void
  onToggleRunning: () => void
  mateOpen: boolean
  onToggleMate: () => void
  showLive2D: boolean
  onToggleLive2D: () => void
}

function abortPipeline(): void {
  pipelineBus.emit('pipeline:abort', undefined)
  const model = getLive2DModel()
  if (model) {
    try { model.stopSpeaking() } catch { /* ignore */ }
  }
}

export function GalgameChatPanel({
  stage,
  avatarUrl,
  onOpenDetails,
  onOpenRoleSettings,
  onToggleRunning,
  mateOpen,
  onToggleMate,
  showLive2D,
  onToggleLive2D,
}: Props): React.JSX.Element {
  const isSending = useChatStore((s) => s.isSending)
  const error = useChatStore((s) => s.error)
  const persistError = useChatStore((s) => s.persistError)
  const send = useChatPipeline()
  const [draft, setDraft] = React.useState('')
  const pendingImages = usePendingImages()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const composingRef = React.useRef(false)
  const compositionEndAtRef = React.useRef(0)
  const role = useRoleStore((s) => s.list.find((card) => card.id === s.activeId))
  const bootAwake = useStartupStore((s) => s.phase === 'awake')
  const runningById = useRoleRuntimeStore((s) => s.byId)
  const running = Boolean(role && isRoleRunning(runningById, role.id))
  const sleeping = Boolean(role && !running)
  const canInteract = bootAwake && !sleeping
  const label = role?.displayName ?? role?.name ?? '角色'

  React.useEffect(() => {
    setASRFinalCallback((text) => {
      if (!text.trim()) return
      const settings = useASRStore.getState().settings
      const directorEnabled = settings?.directorEnabled ?? false
      const autoSend = settings?.autoSend !== false
      const interrupted = consumeVoiceInterruption()
      if (directorEnabled && !interrupted) {
        offerUtterance(text)
        return
      }
      if (autoSend) {
        send(text.trim())
      } else {
        setDraft((prev) => (prev ? prev + ' ' : '') + text.trim())
      }
    })
    setDirectorDispatch((input) => send(input.text, undefined, input.systemPrompt))
    return () => {
      setASRFinalCallback(null)
      setDirectorDispatch(null)
    }
  }, [send])

  function handleSend(): void {
    const text = draft.trim()
    if ((!text && pendingImages.images.length === 0) || isSending || sleeping) return
    const images = pendingImages.images.map((image) => image.url)
    setDraft('')
    pendingImages.clear()
    send(text, images.length > 0 ? images : undefined)
  }

  return (
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="absolute inset-0" aria-hidden>{stage}</div>
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-background/40 to-background"
        aria-hidden
      />

      <header className="relative z-20 flex h-12 shrink-0 items-center gap-2.5 border-b bg-card/85 px-4">
        <span
          className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background text-xs text-brand"
          style={{ color: role?.color }}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            label.slice(0, 1)
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">{label}</h1>
          <p className="text-xs text-muted-foreground">{running ? '运行中' : '沉睡中'}</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggleMate}
            title="相伴窗口"
            aria-label="相伴窗口"
            aria-pressed={mateOpen}
            className={cn('size-8', mateOpen && 'bg-accent text-foreground')}
          >
            <Cat className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggleLive2D}
            title="人物舞台"
            aria-label="人物舞台"
            aria-pressed={showLive2D}
            className={cn('size-8', showLive2D && 'bg-accent text-foreground')}
          >
            {showLive2D ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </Button>
          <div className="mx-1 h-5 w-px bg-border" aria-hidden />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onOpenRoleSettings}
            title="角色设定"
            aria-label="角色设定"
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onOpenDetails}
            title="角色详情"
            aria-label="角色详情"
          >
            <Info className="size-4" />
          </Button>
          <Button type="button" size="sm" variant={running ? 'secondary' : 'default'} onClick={onToggleRunning}>
            {running ? <Moon className="size-3.5" /> : <Play className="size-3.5" />}
            {running ? '休眠' : '唤醒'}
          </Button>
        </div>
      </header>

      <div className="relative z-10 mt-auto flex h-[62%] min-h-0 flex-col bg-background/55">
        <ChatThread roleLabel={label} avatarUrl={avatarUrl} roleColor={role?.color} />

        <div className="shrink-0 px-4 pb-4">
          {(error || persistError) && (
            <div className="mb-2 rounded-md bg-destructive/15 px-3 py-1.5 text-xs text-destructive">
              {error || `聊天记录未保存：${persistError}`}
            </div>
          )}
          <PendingImagesBar pending={pendingImages} />

          <div className="mx-auto w-full max-w-3xl rounded-lg border bg-card p-2 shadow-lg shadow-black/15">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={() => {
                composingRef.current = false
                compositionEndAtRef.current = performance.now()
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey) return
                const native = event.nativeEvent
                // 选字中的回车属于输入法，既不发送也不 preventDefault，否则会打断候选确认
                if (composingRef.current || native.isComposing || native.keyCode === 229) return
                // 选字结束 500ms 内的回车只可能是选词确认的伴生键，吞掉换行但不发送
                if (performance.now() - compositionEndAtRef.current < COMPOSITION_GUARD_MS) {
                  event.preventDefault()
                  return
                }
                event.preventDefault()
                handleSend()
              }}
              onPaste={pendingImages.handlePaste}
              placeholder={sleeping ? '她正在沉睡，先在顶部唤醒她' : canInteract ? '输入消息，可粘贴图片…' : '正在唤醒…'}
              disabled={!canInteract}
              className="max-h-52 min-h-10 resize-none border-0 bg-transparent px-2 py-1.5 text-sm leading-relaxed shadow-none focus-visible:ring-0 [field-sizing:content]"
              rows={1}
            />

            <div className="mt-1 flex items-center gap-0.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  pendingImages.handleFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground"
                title="添加图片"
                aria-label="添加图片"
                disabled={!canInteract}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus className="size-4" />
              </Button>
              <div className={cn(!canInteract && 'pointer-events-none opacity-40')}>
                <MicButton />
              </div>

              <div className="ml-auto flex items-center gap-1">
                <ContextUsageIndicator />
                {isSending ? (
                  <Button size="icon" className="size-8 shrink-0" onClick={abortPipeline} title="停止" aria-label="停止">
                    <Square className="size-3.5" fill="currentColor" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={handleSend}
                    disabled={(!draft.trim() && pendingImages.images.length === 0) || !canInteract}
                    title="发送"
                    aria-label="发送"
                  >
                    <Send className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {!role && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 text-sm text-muted-foreground">
          请选择一个角色
        </div>
      )}
    </div>
  )
}
