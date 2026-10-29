import * as React from 'react'
import { X } from 'lucide-react'
import { middleEllipsis } from '@/lib/filename'

const MAX_IMAGES = 6
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 1568
const NAME_MAX_CHARS = 20

export interface PendingImage {
  url: string
  name: string
}

export interface PendingImages {
  images: PendingImage[]
  handlePaste: (e: React.ClipboardEvent) => void
  handleFiles: (files: FileList | null) => void
  remove: (index: number) => void
  clear: () => void
  notice: string | null
}

export function usePendingImages(): PendingImages {
  const [images, setImages] = React.useState<PendingImage[]>([])
  const [notice, setNotice] = React.useState<string | null>(null)
  const noticeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = React.useCallback((msg: string) => {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 2500)
  }, [])

  const appendImage = React.useCallback(
    (url: string, name: string) => {
      setImages((prev) => {
        if (prev.length >= MAX_IMAGES) {
          flash(`最多附带 ${MAX_IMAGES} 张图片`)
          return prev
        }
        return [...prev, { url, name }]
      })
    },
    [flash]
  )

  const readFile = React.useCallback(
    (file: File, index = 0) => {
      if (!file.type.startsWith('image/')) return
      if (file.size > MAX_IMAGE_BYTES) {
        flash(`图片过大（>${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB），已跳过`)
        return
      }
      const name = file.name || `粘贴图片 ${index + 1}.png`
      const reader = new FileReader()
      reader.onload = () => {
        const raw = reader.result as string
        const img = new Image()
        img.onload = () => {
          const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height))
          if (scale === 1 && file.size <= 512 * 1024) {
            appendImage(raw, name)
            return
          }
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(img.width * scale)
          canvas.height = Math.round(img.height * scale)
          canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
          appendImage(canvas.toDataURL('image/jpeg', 0.85), name)
        }
        img.onerror = () => appendImage(raw, name)
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
      let index = 0
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          hasImage = true
          const file = item.getAsFile()
          if (file) readFile(file, index++)
        }
      }
      if (hasImage) e.preventDefault()
    },
    [readFile]
  )

  const handleFiles = React.useCallback(
    (files: FileList | null) => {
      if (!files) return
      Array.from(files).forEach((file, index) => readFile(file, index))
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
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1.5">
      {pending.images.map((image, i) => (
        <div
          key={i}
          className="edge flex h-7 max-w-[13rem] items-center gap-1.5 rounded-lg bg-muted/70 pl-1 pr-1"
        >
          <img src={image.url} alt="" className="size-5 shrink-0 rounded-[4px] object-cover" />
          <span
            className="min-w-0 flex-1 overflow-hidden text-xs leading-none text-muted-foreground"
            title={image.name}
          >
            {middleEllipsis(image.name, NAME_MAX_CHARS)}
          </span>
          <button
            type="button"
            onClick={() => pending.remove(i)}
            title={`移除 ${image.name}`}
            className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
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
