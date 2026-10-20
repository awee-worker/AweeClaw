/**
 * 截图标注数据结构
 *
 * 所有坐标均为画布物理像素：渲染层用 CSS 偏移 × scaleFactor 换算后写入。
 * 导出时画布尺寸即物理像素，因此坐标可直接用于绘制与裁剪。
 */

/** 标注工具类型 */
export type AnnotationTool =
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'pen'
  | 'highlight'
  | 'mosaic'
  | 'text'

/** 画布坐标点（物理像素） */
export interface Point {
  x: number
  y: number
}

/** 单条标注 */
export interface AnnotationItem {
  id: string
  tool: AnnotationTool
  /** 描边/填充色（#rrggbb） */
  color: string
  /** 线宽（物理像素） */
  lineWidth: number
  /** 起点：矩形/椭圆/箭头/高亮/马赛克的拖拽起点，文字的锚点 */
  start: Point
  /** 终点：矩形/椭圆/箭头/高亮/马赛克的拖拽终点 */
  end: Point
  /** 画笔轨迹点（仅 pen 使用） */
  points: Point[]
  /** 文字内容（仅 text 使用，支持换行） */
  text?: string
  /** 字号（物理像素，仅 text 使用） */
  fontSize?: number
}

/** 主进程回传的待编辑截图 */
export interface EditImagePayload {
  /** 裁剪后的截图 base64（不含 data: 前缀） */
  base64: string
  /** 截图物理像素宽度 */
  width: number
  /** 截图物理像素高度 */
  height: number
  /** 主屏缩放因子，用于 CSS 偏移与物理像素换算 */
  scaleFactor: number
}

/** 可选的标注颜色（与截图常用色系一致） */
export const ANNOTATION_COLORS = [
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#0a84ff',
  '#ffffff',
  '#1c1c1e',
] as const

/** 可选的线宽档位（CSS 像素，绘制前乘以 scaleFactor） */
export const ANNOTATION_LINE_WIDTHS = [3, 5, 8] as const
