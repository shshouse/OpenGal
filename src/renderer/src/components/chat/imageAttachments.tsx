/**
 * 图片附件：粘贴 / 选图 → data:base64 URL 暂存，发送时随 user 消息进多模态 content。
 *
 * 复用于桌面 ChatPanel 与移动 GalgameChatPanel：
 * - usePendingImages：管理待发送图片列表 + 粘贴/文件读取
 * - PendingImagesBar：输入框上方的待发送缩略图条（可单张移除）
 */

import * as React from 'react'
import { X } from 'lucide-react'

const MAX_IMAGES = 6
/** 单张图片超过该体积（字节）则提示过大（base64 会再膨胀 ~33%） */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export interface PendingImages {
  images: string[]
  /** 粘贴事件处理：直接挂在 Textarea 的 onPaste 上 */
  handlePaste: (e: React.ClipboardEvent) => void
  /** 文件选择处理：挂在隐藏 <input type="file"> 的 onChange 上 */
  handleFiles: (files: FileList | null) => void
  remove: (index: number) => void
  clear: () => void
  /** 读取错误/超限提示（短暂展示） */
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

  const readFile = React.useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return
      if (file.size > MAX_IMAGE_BYTES) {
        flash(`图片过大（>${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB），已跳过`)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const url = reader.result as string
        setImages((prev) => {
          if (prev.length >= MAX_IMAGES) {
            flash(`最多附带 ${MAX_IMAGES} 张图片`)
            return prev
          }
          return [...prev, url]
        })
      }
      reader.readAsDataURL(file)
    },
    [flash]
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
      // 有图片时才拦截默认粘贴（避免抢占纯文本粘贴）
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

/** 待发送图片预览条：缩略图 + 单张移除按钮 */
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
