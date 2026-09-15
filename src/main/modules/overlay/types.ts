/**
 * Overlay（字幕 / 弹幕悬浮层）协议类型
 *
 * 协议契约来自 super-ai-browser 的 `py/overlay_router.py`，字段名保持一致
 * （便于与源项目行为对齐，以及第三方脚本零改造接入）：
 *   { "action": "show",  "data": { id, type, content, danmu_type } }
 *   { "action": "clear" }
 *
 * 新增字段一律为可选（platform / ts），避免破坏既有消费方。
 *
 * @module overlay/types
 */

/** 悬浮层形态：底部字幕条 / 顶部滚动弹幕 */
export type OverlayMode = 'subtitle' | 'danmaku'

/**
 * 弹幕类型（与 `live_router.py` 的 danmu_type 完全一致）。
 *
 * - danmaku     普通弹幕
 * - gift        礼物
 * - buy_guard   上舰（大航海）
 * - super_chat  醒目留言
 * - enter_room  进入房间
 * - follow      关注
 * - like        点赞
 */
export type DanmuType =
  | 'danmaku'
  | 'gift'
  | 'buy_guard'
  | 'super_chat'
  | 'enter_room'
  | 'follow'
  | 'like'

/** 直播/系统事件归一化载荷 */
export interface OverlayEventPayload {
  id: string
  type: 'message'
  content: string
  danmu_type: DanmuType
  /** AweeClaw 扩展：来源平台（bilibili / youtube / twitch / local） */
  platform?: string
  /** AweeClaw 扩展：事件时间戳 */
  ts?: number
}

/** 广播给悬浮页面的指令 */
export type OverlayCommand =
  | { action: 'show'; data: OverlayEventPayload }
  | { action: 'clear' }

/** 字幕样式配置 */
export interface SubtitleStyleConfig {
  /** 字号（px，以 1080p 为基准） */
  fontSize: number
  /** 单条字幕停留时长（ms） */
  durationMs: number
  /** 最多同时显示行数（超出滚动） */
  maxLines: number
  /** 文字描边宽度（px，0 = 无描边） */
  strokeWidth: number
  /** 背景条不透明度（0 ~ 1） */
  bgOpacity: number
}

/** 弹幕样式配置 */
export interface DanmakuStyleConfig {
  fontSize: number
  /** 滚动速度（px/秒，以 1080p 为基准） */
  speed: number
  /** 轨道数（同时显示行数） */
  tracks: number
  /** 整体不透明度（0 ~ 1） */
  opacity: number
  /** 是否过滤进场/点赞等低优先级事件 */
  filterLowPriority: boolean
}

/** 应用内透明窗口配置 */
export interface OverlayWindowConfig {
  width: number
  height: number
  positionX: number | null
  positionY: number | null
  /** 窗口整体不透明度（0.1 ~ 1） */
  opacity: number
  alwaysOnTop: boolean
  /** 鼠标穿透（默认开启：悬浮层不应抢走桌面点击） */
  clickThrough: boolean
  /** 锁定位置：开启后拖拽无效 */
  locked: boolean
}

/** 悬浮层总配置 */
export interface OverlayConfig {
  /** 总开关：关闭时不起 HTTP 服务、不建窗口 */
  enabled: boolean
  /** 外部模式：内置 HTTP + WS 服务（供 OBS 浏览器源 / 第三方脚本消费） */
  serverEnabled: boolean
  /** 服务端口（固定优先，占用时向上探测） */
  port: number
  /** 应用内模式：透明窗口 */
  windowEnabled: boolean
  /** 应用内窗口默认展示形态 */
  windowMode: OverlayMode
  window: OverlayWindowConfig
  subtitle: SubtitleStyleConfig
  danmaku: DanmakuStyleConfig
}
