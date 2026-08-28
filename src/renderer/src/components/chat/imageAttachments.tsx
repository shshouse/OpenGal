import * as React from 'react'
import { X } from 'lucide-react'

const MAX_IMAGES = 6
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 1568

export interface PendingImages {
  images: string[]
  handlePaste: (e: React.ClipboardEvent) => void
  handleFiles: (files: FileList | null) => void
  remove: (index: number) => void
  clear: () => void
  notice: string | null
}

export function usePendingImages(): PendingImages {
  const [images, setImages] = React.useState<string[]>([])
  const [notice, setNotice] = React.useState<string | null>(null)
  const noticeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = React.useCallback((msg: string) => {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 2500)
  }, [])

  const appendImage = React.useCallback(
    (url: string) => {
      setImages((prev) => {
        if (prev.length >= MAX_IMAGES) {
          flash(`最多附带 ${MAX_IMAGES} 张图片`)
          return prev
        }
        return [...prev, url]
      })
    },
    [flash]
  )

  const readFile = React.useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return
      if (file.size > MAX_IMAGE_BYTES) {
        flash(`图片过大（>${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB），已跳过`)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const raw = reader.result as string
        const img = new Image()
        img.onload = () => {
          const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height))
          if (scale === 1 && file.size <= 512 * 1024) {
            appendImage(raw)
            return
          }
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(img.width * scale)
          canvas.height = Math.round(img.height * scale)
          canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
          appendImage(canvas.toDataURL('image/jpeg', 0.85))
        }
        img.onerror = () => appendImage(raw)
        img.src = raw
      }
      reader.readAsDataURL(file)
    },
    [flash, appendImage]
  )

  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items || items.length === 0) return
      let hasImage = false
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          hasImage = true
          const file = item.getAsFile()
          if (file) readFile(file)
        }
      }
      if (hasImage) e.preventDefault()
    },
    [readFile]
  )

  const handleFiles = React.useCallback(
    (files: FileList | null) => {
      if (!files) return
      for (const file of Array.from(files)) readFile(file)
    },
    [readFile]
  )

  const remove = React.useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clear = React.useCallback(() => setImages([]), [])

  return { images, handlePaste, handleFiles, remove, clear, notice }
}

export function PendingImagesBar({ pending }: { pending: PendingImages }) {
  if (pending.images.length === 0 && !pending.notice) return null
  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      {pending.images.map((url, i) => (
        <div
          key={i}
          className="group relative size-14 overflow-hidden rounded-md border bg-muted"
        >
          <img src={url} alt={`附件 ${i + 1}`} className="size-full object-cover" />
          <button
            type="button"
            onClick={() => pending.remove(i)}
            title="移除"
            className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {pending.notice && (
        <span className="text-xs text-muted-foreground">{pending.notice}</span>
      )}
    </div>
  )
}
