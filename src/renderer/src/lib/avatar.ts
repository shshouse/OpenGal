import { getImageHeadCrop } from './headCrop'

/** 立绘整图先裁出头部，避免小方框里只看到衣服或腿 */
export async function cropImageHead(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const bitmap = await createImageBitmap(await response.blob())
    const crop = getImageHeadCrop(bitmap.width, bitmap.height)
    if (crop.size <= 0) {
      bitmap.close()
      return null
    }
    const canvas = document.createElement('canvas')
    canvas.width = crop.size
    canvas.height = crop.size
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return null
    }
    context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, crop.size, crop.size)
    bitmap.close()
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
