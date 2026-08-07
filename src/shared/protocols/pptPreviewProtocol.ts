/**
 * PPT 预览协议 — 定义幻灯片预览数据的类型契约
 *
 * 数据流：mcp-pptx 插件 → PptPreviewBridge → IPC → 预览窗口渲染进程
 * 预览窗口根据 JSON 数据用 React 渲染幻灯片元素（非 PPT 图片截图），
 * 实现 AI 生成 PPT 过程中的实时预览。
 *
 * 坐标系：x/y/w/h 均为英寸（与 pptxgenjs 一致），预览渲染时按比例缩放到画布像素。
 */

// ============================================
// 幻灯片元素类型
// ============================================

/** 文本元素 */
export interface PptTextElement {
  type: 'text'
  /** 左上角 X（英寸） */
  x: number
  /** 左上角 Y（英寸） */
  y: number
  /** 宽度（英寸） */
  w: number
  /** 高度（英寸） */
  h: number
  /** 文本内容（支持多行，\n 分隔） */
  text: string
  /** 字号（磅） */
  fontSize: number
  /** 字体颜色（十六进制，如 #333333） */
  color: string
  /** 是否加粗 */
  bold?: boolean
  /** 是否斜体 */
  italic?: boolean
  /** 对齐方式 */
  align?: 'left' | 'center' | 'right'
  /** 垂直对齐 */
  valign?: 'top' | 'middle' | 'bottom'
  /** 背景色 */
  fill?: string
}

/** 形状元素 */
export interface PptShapeElement {
  type: 'shape'
  /** 形状类型 */
  shape: 'rect' | 'roundRect' | 'ellipse' | 'line' | 'arrow' | 'triangle' | 'chevron'
  x: number
  y: number
  w: number
  h: number
  /** 填充色（十六进制） */
  fill?: string
  /** 边框色（十六进制） */
  line?: string
  /** 边框宽度（磅） */
  lineWidth?: number
  /** 旋转角度 */
  rotate?: number
}

/** 图片元素 */
export interface PptImageElement {
  type: 'image'
  x: number
  y: number
  w: number
  h: number
  /** 图片源：本地路径 / data:image base64 / http URL */
  src: string
  /** 旋转角度 */
  rotate?: number
}

/** 图表元素 */
export interface PptChartElement {
  type: 'chart'
  /** 图表类型 */
  chartType: 'bar' | 'pie' | 'line' | 'area'
  x: number
  y: number
  w: number
  h: number
  /** 图表数据 */
  data: PptChartData
  /** 标题 */
  title?: string
}

/** 图表数据 */
export interface PptChartData {
  /** 分类标签 */
  categories: string[]
  /** 数据系列 */
  series: Array<{
    name: string
    values: number[]
  }>
}

/** 表格元素 */
export interface PptTableElement {
  type: 'table'
  x: number
  y: number
  w: number
  h: number
  /** 表格数据（行×列） */
  rows: string[][]
  /** 首行是否为表头 */
  headerRow?: boolean
  /** 列宽比例（和为 1） */
  colWidths?: number[]
  /** v2.2：主题配色（供预览渲染与 pptxgenjs 输出一致） */
  style?: {
    headerFill?: string
    altRowFill?: string
    textColor?: string
    borderColor?: string
  }
}

/** 联合类型：所有支持的幻灯片元素 */
export type PptElement =
  | PptTextElement
  | PptShapeElement
  | PptImageElement
  | PptChartElement
  | PptTableElement

// ============================================
// 幻灯片 / 演示文稿
// ============================================

/** 幻灯片背景 */
export interface PptSlideBackground {
  /** 背景色（十六进制） */
  color?: string
  /** 背景图（路径/base64/URL） */
  image?: string
}

/** 单张幻灯片预览数据 */
export interface PptSlideData {
  /** 会话 ID（标识一次 PPT 生成任务） */
  sessionId: string
  /** 幻灯片索引（从 0 开始） */
  slideIndex: number
  /** 幻灯片标题 */
  title?: string
  /** 幻灯片布局 */
  layout?:
    | 'blank'
    | 'title'
    | 'titleContent'
    | 'sectionHeader'
    | 'twoContent'
    | 'cover'
    | 'toc'
    | 'section'
    | 'content-text'
    | 'content-data'
    | 'closing'
  /** 背景 */
  background?: PptSlideBackground
  /** 幻灯片上的所有元素 */
  elements: PptElement[]
}

/** 演示文稿元信息 */
export interface PptPresentationMeta {
  sessionId: string
  title: string
  /** 幻灯片尺寸 */
  slideSize?: { width: number; height: number }
  /** 主题色 */
  themeColor?: string
  /** 幻灯片总数 */
  slideCount: number
  /** 是否已完成生成 */
  completed: boolean
  /** 保存路径（完成后才有） */
  filePath?: string
}

// ============================================
// IPC 通道
// ============================================

export const PPT_PREVIEW_CHANNELS = {
  /** 打开预览窗口（主进程 → 渲染进程） */
  OPEN: 'ppt-preview:open',
  /** 推送幻灯片数据（主进程 → 渲染进程） */
  PUSH_SLIDE: 'ppt-preview:push-slide',
  /** 标记完成（主进程 → 渲染进程） */
  MARK_COMPLETE: 'ppt-preview:mark-complete',
  /** 关闭预览（渲染进程 → 主进程） */
  CLOSE: 'ppt-preview:close',
  /** 导出请求（渲染进程 → 主进程） */
  EXPORT: 'ppt-preview:export',
} as const

// ============================================
// Tab 路径辅助函数（v2.3 主窗口内嵌模式）
// ============================================

/** PPT 预览 Tab 的路径前缀 */
export const PPT_PREVIEW_PATH_PREFIX = 'ppt-preview://session/'

/** 构建 PPT 预览 Tab 的路径 */
export function buildPptPreviewPath(sessionId: string): string {
  return `${PPT_PREVIEW_PATH_PREFIX}${sessionId}`
}

/** 判断路径是否为 PPT 预览 Tab */
export function isPptPreviewPath(path: string): boolean {
  return typeof path === 'string' && path.startsWith(PPT_PREVIEW_PATH_PREFIX)
}

/** 从 PPT 预览 Tab 路径中提取 sessionId */
export function extractSessionIdFromPptPreviewPath(path: string): string | null {
  if (!isPptPreviewPath(path)) return null
  return path.slice(PPT_PREVIEW_PATH_PREFIX.length)
}
