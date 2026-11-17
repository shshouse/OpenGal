/** Live2D 截图按比例裁出头部，用于侧栏头像 */
export interface HeadCrop {
  x: number
  y: number
  size: number
}

export interface ModelBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 立绘整图没有模型边界，按顶部中心取头部方形区域；竖长全身图保留完整头部和下巴 */
export function getImageHeadCrop(width: number, height: number): HeadCrop {
  if (width <= 0 || height <= 0) return { x: 0, y: 0, size: 0 }
  const size = height >= width * 1.8
    ? Math.min(Math.floor(width * 0.78), height)
    : Math.min(Math.floor(Math.min(width, height) * 0.8), width, height)
  return {
    x: Math.max(0, Math.floor((width - size) / 2)),
    y: 0,
    size,
  }
}

export function getHeadCrop(width: number, height: number, model?: ModelBounds): HeadCrop {
  if (width <= 0 || height <= 0) return { x: 0, y: 0, size: 0 }

  if (model && model.width > 0 && model.height > 0) {
    const size = Math.min(
      Math.floor(Math.min(model.width * 0.46, model.height * 0.3)),
      width,
      height,
    )
    if (size <= 0) return { x: 0, y: 0, size: 0 }
    const x = Math.max(0, Math.min(width - size, Math.floor(model.x + (model.width - size) / 2)))
    const y = Math.max(0, Math.min(height - size, Math.floor(model.y)))
    return { x, y, size }
  }

  const size = Math.floor(Math.min(width * 0.22, height * 0.28))
  return {
    x: Math.max(0, Math.floor((width - size) / 2)),
    y: 0,
    size,
  }
}
