import * as React from 'react'
import { ImagePlus, Send, Square } from 'lucide-react'
import { evaluateWakeGate } from '@core/harness/wakeGate'
import { isRoleRunning } from '@shared/role/runtime'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useASRStore, setASRFinalCallback } from '@/features/asr/asrStore'
import { useChatStore } from '@/features/chat/chatStore'
import { offerUtterance, setDirectorDispatch } from '@/features/director/directorWorker'
import { getLive2DModel } from '@/features/live2d/live2dBus'
import { consumeVoiceInterruption } from '@/features/pipeline/bargeIn'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import { useChatPipeline } from '@/features/pipeline/useChatPipeline'
import { useRoleRuntimeStore } from '@/features/role/roleRuntimeStore'
import { useRoleStore } from '@/features/role/roleStore'
import { MicButton } from './MicButton'
import { PendingImagesBar, usePendingImages } from './imageAttachments'

const COMPOSITION_GUARD_MS = 500

interface Props {
  compact?: boolean
  className?: string
  placeholder?: string
}

function abortCurrentTurn(): void {
  pipelineBus.emit('pipeline:abort', undefined)
  try {
    getLive2DModel()?.stopSpeaking()
  } catch {
    /* ignore */
  }
}

export function ChatComposerBar({ compact = false, className, placeholder }: Props): React.JSX.Element {
  const isSending = useChatStore((s) => s.isSending)
  const error = useChatStore((s) => s.error)
  const persistError = useChatStore((s) => s.persistError)
  const asrPartial = useASRStore((s) => s.partial)
  const send = useChatPipeline()

  const [draft, setDraft] = React.useState('')
  const [wakeHint, setWakeHint] = React.useState<string | null>(null)
  const wakeActiveUntilRef = React.useRef(0)
  const pendingImages = usePendingImages()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const composingRef = React.useRef(false)
  const compositionEndAtRef = React.useRef(0)

  const role = useRoleStore((s) => s.list.find((card) => card.id === s.activeId))
  const runningById = useRoleRuntimeStore((s) => s.byId)
  const running = Boolean(role && isRoleRunning(runningById, role.id))
  const canInteract = Boolean(role && running)
  const label = role?.displayName ?? role?.name ?? '角色'

  React.useEffect(() => {
    setASRFinalCallback((text) => {
      const clean = text.trim()
      if (!clean) return
      const currentRole = useRoleStore.getState().getActive()
      const settings = useASRStore.getState().settings
      const directorEnabled = settings?.directorEnabled ?? false
      const autoSend = settings?.autoSend !== false
      const interrupted = consumeVoiceInterruption()

      // Agent 模式开启语音导演/唤醒时，先在本地零 Token 判定是否叫了角色名字或处于连续对话窗口
      if (currentRole && (currentRole.mode ?? 'agent') === 'agent' && directorEnabled && !interrupted) {
        const names = [currentRole.displayName, currentRole.name].filter(
          (n): n is string => Boolean(n && n.trim()),
        )
        const gate = evaluateWakeGate({
          utterance: clean,
          now: Date.now(),
          activeUntil: wakeActiveUntilRef.current,
          roleNames: names,
          requireWakeWord: true,
          windowMs: 30_000,
        })
        wakeActiveUntilRef.current = gate.nextActiveUntil
        if (!gate.allowed) {
          setWakeHint(`待机监听中，喊「${names[0] ?? label}」激活对话`)
          return
        }
        setWakeHint(null)
        send(gate.cleanedUtterance || clean)
        return
      }

      if (directorEnabled && !interrupted) {
        offerUtterance(clean)
        return
      }
      if (autoSend) {
        send(clean)
      } else {
        setDraft((prev) => (prev ? `${prev} ${clean}` : clean))
      }
    })
    setDirectorDispatch((input) => send(input.text, undefined, input.systemPrompt))
    return () => {
      setASRFinalCallback(null)
      setDirectorDispatch(null)
    }
  }, [label, send])

  function handleSend(): void {
    const text = draft.trim()
    if ((!text && pendingImages.images.length === 0) || isSending || !canInteract) return
    const images = pendingImages.images.map((item) => item.url)
    setDraft('')
    setWakeHint(null)
    pendingImages.clear()
    wakeActiveUntilRef.current = Date.now() + 30_000
    send(text, images.length > 0 ? images : undefined)
  }

  const hintError = error || persistError

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {hintError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-popover px-3 py-1.5 text-xs text-destructive"
        >
          {hintError}
        </div>
      ) : null}

      {asrPartial ? (
        <div className="truncate rounded-lg border bg-popover px-3 py-1 text-xs text-muted-foreground">
          正在识别：{asrPartial}
        </div>
      ) : wakeHint ? (
        <div className="truncate rounded-lg border bg-popover px-3 py-1 text-xs text-muted-foreground">
          {wakeHint}
        </div>
      ) : null}

      {pendingImages.images.length > 0 || pendingImages.notice ? (
        <div className="rounded-lg border bg-popover px-2.5 pt-1.5">
          <PendingImagesBar pending={pendingImages} />
        </div>
      ) : null}

      <div
        className={cn(
          'flex items-end gap-1.5 rounded-xl border bg-popover text-popover-foreground',
          compact ? 'edge-float px-2 py-1.5' : 'bg-card px-2.5 py-2',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            pendingImages.handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={!canInteract || isSending}
          title="添加图片"
          aria-label="添加图片"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ImagePlus className="size-4" />
        </Button>

        <Textarea
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={pendingImages.handlePaste}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
            compositionEndAtRef.current = Date.now()
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey) return
            const native = e.nativeEvent
            const inComposition =
              composingRef.current ||
              native.isComposing ||
              native.keyCode === 229 ||
              Date.now() - compositionEndAtRef.current < COMPOSITION_GUARD_MS
            if (inComposition) return
            e.preventDefault()
            handleSend()
          }}
          placeholder={
            placeholder ??
            (!role
              ? '先创建或选择一个角色'
              : !running
                ? `${label}休息中，唤醒后开始对话`
                : `和${label}说点什么…`)
          }
          disabled={!canInteract}
          className={cn(
            'max-h-[240px] min-h-[36px] flex-1 resize-none border-0 bg-transparent px-1.5 py-1.5 text-sm shadow-none focus-visible:ring-0',
            !compact && 'min-h-[44px]',
          )}
        />

        <div className="flex shrink-0 items-center gap-1">
          {canInteract ? <MicButton /> : null}
          {isSending ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={abortCurrentTurn}
              title="停止回复"
              aria-label="停止回复"
              className="size-8"
            >
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              disabled={!canInteract || (!draft.trim() && pendingImages.images.length === 0)}
              title="发送"
              aria-label="发送"
              className="size-8"
            >
              <Send className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
