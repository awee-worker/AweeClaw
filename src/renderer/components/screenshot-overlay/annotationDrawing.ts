/**
 * 截图标注绘制内核
 *
 * 只负责把标注画到 canvas 上，不持有任何状态：
 * - 图形类标注直接在画布上描边/填充
 * - 马赛克需要回采底图像素，因此额外接收底图 canvas
 *
 * 坐标系统一为物理像素，调用方负责把鼠标 CSS 偏移乘以 scaleFactor。
 */

import type { AnnotationItem, Point } from './annotationTypes'

/** 把两个对角点整理成「左上角 + 宽高」 */
function toRect(start: Point, end: Point): {
  x: number
  y: number
  width: number
  height: number
} {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

/** 箭头：主线 + 两条箭头翼 */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  lineWidth: number,
): void {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 1) return

  const angle = Math.atan2(dy, dx)
  // 箭头翼长度随线宽增长，但设下限避免细线时箭头小到看不清
  const headLength = Math.max(lineWidth * 4, 12)
  const headAngle = Math.PI / 7

  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(
    end.x - headLength * Math.cos(angle - headAngle),
    end.y - headLength * Math.sin(angle - headAngle),
  )
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(
    end.x - headLength * Math.cos(angle + headAngle),
    end.y - headLength * Math.sin(angle + headAngle),
  )
  ctx.stroke()
}

/** 画笔轨迹：折线连接所有采样点 */
function drawPath(ctx: CanvasRenderingContext2D, points: Point[]): void {
  if (points.length === 0) return

  // 单点也要可见：画一个圆点
  if (points.length === 1) {
    ctx.beginPath()
    ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.stroke()
}

/**
 * 马赛克：把底图对应区域缩到极小再放大回去，实现像素块化
 *
 * 块大小跟线宽联动（3/5/8 → 约 9/15/24 物理像素），
 * 用户切换到粗档就能获得更明显的遮挡效果。
 */
function drawMosaic(
  ctx: CanvasRenderingContext2D,
  baseCanvas: HTMLCanvasElement,
  rect: { x: number; y: number; width: number; height: number },
  lineWidth: number,
): void {
  const { x, y, width, height } = rect
  if (width < 1 || height < 1) return

  const block = Math.max(6, lineWidth * 3)
  const smallWidth = Math.max(1, Math.round(width / block))
  const smallHeight = Math.max(1, Math.round(height / block))

  const buffer = document.createElement('canvas')
  buffer.width = smallWidth
  buffer.height = smallHeight
  const bufferCtx = buffer.getContext('2d')
  if (!bufferCtx) return

  bufferCtx.imageSmoothingEnabled = false
  bufferCtx.drawImage(baseCanvas, x, y, width, height, 0, 0, smallWidth, smallHeight)

  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(buffer, 0, 0, smallWidth, smallHeight, x, y, width, height)
  ctx.restore()
}

/** 文字：逐行绘制，先描边再填充，保证在任意背景上都可读 */
function drawText(ctx: CanvasRenderingContext2D, item: AnnotationItem): void {
  const content = item.text ?? ''
  if (!content) return

  const fontSize = item.fontSize ?? 20
  const lineHeight = fontSize * 1.3

  ctx.save()
  ctx.font = `600 ${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  const outlineWidth = Math.max(2, fontSize / 7)
  const lines = content.split('\n')

  lines.forEach((line, index) => {
    if (!line) return
    const lineY = item.start.y + index * lineHeight
    ctx.lineWidth = outlineWidth
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.lineJoin = 'round'
    ctx.strokeText(line, item.start.x, lineY)
    ctx.fillStyle = item.color
    ctx.fillText(line, item.start.x, lineY)
  })

  ctx.restore()
}

/** 绘制单条标注 */
export function drawItem(
  ctx: CanvasRenderingContext2D,
  item: AnnotationItem,
  baseCanvas: HTMLCanvasElement,
): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = item.color
  ctx.fillStyle = item.color
  ctx.lineWidth = item.lineWidth

  switch (item.tool) {
    case 'rect': {
      const rect = toRect(item.start, item.end)
      if (rect.width < 1 && rect.height < 1) break
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
      break
    }
    case 'ellipse': {
      const rect = toRect(item.start, item.end)
      if (rect.width < 1 || rect.height < 1) break
      ctx.beginPath()
      ctx.ellipse(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        rect.width / 2,
        rect.height / 2,
        0,
        0,
        Math.PI * 2,
      )
      ctx.stroke()
      break
    }
    case 'arrow': {
      drawArrow(ctx, item.start, item.end, item.lineWidth)
      break
    }
    case 'pen': {
      drawPath(ctx, item.points)
      break
    }
    case 'highlight': {
      const rect = toRect(item.start, item.end)
      if (rect.width < 1 || rect.height < 1) break
      ctx.globalAlpha = 0.32
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      break
    }
    case 'mosaic': {
      drawMosaic(ctx, baseCanvas, toRect(item.start, item.end), item.lineWidth)
      break
    }
    case 'text': {
      drawText(ctx, item)
      break
    }
    default:
      break
  }

  ctx.restore()
}

/** 重绘整个画面：底图 + 全部已确认标注 */
export function renderCommitted(
  ctx: CanvasRenderingContext2D,
  baseCanvas: HTMLCanvasElement,
  items: AnnotationItem[],
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(baseCanvas, 0, 0)
  for (const item of items) {
    drawItem(ctx, item, baseCanvas)
  }
}

/** 清空后绘制单条草稿（拖拽过程中的实时预览） */
export function renderDraft(
  ctx: CanvasRenderingContext2D,
  baseCanvas: HTMLCanvasElement,
  item: AnnotationItem | null,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height)
  if (!item) return
  drawItem(ctx, item, baseCanvas)
}

/** 生成一个空标注项 */
export function createItem(
  tool: AnnotationItem['tool'],
  color: string,
  lineWidth: number,
  start: Point,
): AnnotationItem {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  return {
    id: stamp,
    tool,
    color,
    lineWidth,
    start,
    end: { ...start },
    points: [start],
  }
}
