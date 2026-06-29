import { Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useASRStore } from '@/features/asr/asrStore'
import { Waveform } from './Waveform'
import { cn } from '@/lib/utils'

export function MicButton() {
  const running = useASRStore((s) => s.running)
  const error = useASRStore((s) => s.error)
  const start = useASRStore((s) => s.start)
  const stop = useASRStore((s) => s.stop)

  async function toggle(): Promise<void> {
    if (running) {
      await stop()
    } else {
      await start()
    }
  }

  return (
    <div className="flex items-center gap-2">
      {running && <Waveform />}
      <div className="relative">
        <Button
          variant={running ? 'default' : 'outline'}
          size="icon"
          onClick={toggle}
          title={error || (running ? '停止语音输入' : '语音输入')}
          className={cn(error && 'border-destructive text-destructive')}
        >
          {running ? <Mic className="size-4" /> : <MicOff className="size-4" />}
        </Button>
        {error && (
          <div className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-destructive px-2 py-1 text-[11px] text-destructive-foreground shadow">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
