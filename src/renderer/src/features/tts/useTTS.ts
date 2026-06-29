import { useCallback, useRef, useState } from 'react'

export interface TTSState {
  speaking: boolean
  error: string | null
}

export function useTTS() {
  const [state, setState] = useState<TTSState>({ speaking: false, error: null })
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    setState({ speaking: false, error: null })
  }, [])

  const speak = useCallback(
    async (text: string): Promise<void> => {
      stop()
      setState({ speaking: true, error: null })
      try {
        const result = await window.opengal.tts.speak({ text })
        if (!result.success || !result.data) {
          throw new Error(result.error || 'TTS failed')
        }
        const { audioBase64, mimeType } = result.data
        const dataUrl = `data:${mimeType};base64,${audioBase64}`
        const audio = new Audio(dataUrl)
        audioRef.current = audio
        audio.onended = () => setState({ speaking: false, error: null })
        audio.onerror = () =>
          setState({ speaking: false, error: 'Audio playback error' })
        await audio.play()
      } catch (err) {
        setState({ speaking: false, error: (err as Error).message })
      }
    },
    [stop]
  )

  const ping = useCallback(async () => {
    const result = await window.opengal.tts.ping()
    if (!result.success || !result.data) {
      return { ok: false, message: result.error || 'ping failed' }
    }
    return result.data
  }, [])

  return { ...state, speak, stop, ping }
}
