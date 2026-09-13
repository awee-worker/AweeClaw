/**
 * ONLYOFFICE 在线编辑协议 — 类型契约与 Tab 路径辅助
 *
 * 场景：本地文档（doc/docx/ppt/pptx/xls/xlsx/csv 等）经 ONLYOFFICE 在线编辑后回写本地原文件。
 *
 * 链路：
 *   本地文件 → 主进程上传 {ds}/oo-gw/upload?name=<uuid>.<ext>
 *            → 渲染打开 oo-edit Tab（webview 加载 {ds}/oo-gw/demo.html?file=…）
 *            → 用户编辑（DS autosave → 网关 /data 落盘）
 *            → 「保存并关闭」POST {ds}/oo-gw/save?file=…（force save 并等待回写）
 *            → 下载 {ds}/oo-gw/files/<name> → 主进程原子写回本地源文件
 *            → DELETE {ds}/oo-gw/files/<name> 清理远端会话副本
 *
 * 服务器配置放在 {userData}/.aweeclaw/aweeclaw-config.json：
 *   {
 *     "serverUrl": "https://gateway.aweeclaw.com",   // 后端网关（既有字段）
 *     "onlyOffice": {                                 // ONLYOFFICE（新字段，同一文件）
 *       "serverUrl": "https://onlyoffice.aweeclaw.com",
 *       "basePath": "/oo-gw",
 *       "adminKey": ""                                 // 网关管理密钥（可选，勿下发给渲染）
 *     }
 *   }
 */

/** ONLYOFFICE 服务器配置（aweeclaw-config.json 中的 onlyOffice 段） */
export interface OnlyOfficeServerSettings {
  /** DS 公网基址，如 https://onlyoffice.aweeclaw.com（置空字符串表示禁用） */
  serverUrl: string
  /** 网关对外路径前缀，默认 /oo-gw */
  basePath: string
  /** 网关管理密钥（save/delete 需携带 x-gw-key；网关未配置 GW_ADMIN_KEY 时留空） */
  adminKey?: string
}

/** ONLYOFFICE 编辑会话元信息（渲染 Tab 与主进程共享） */
export interface OnlyOfficeEditSessionMeta {
  /** 会话 ID（= 本地 Tab 路径主键） */
  sessionId: string
  /** 本地源文件绝对路径（保存时回写目标） */
  sourcePath: string
  /** 网关上的存储名（uuid.ext），与源文件名隔离避免同名冲突 */
  remoteName: string
  /** 编辑器显示标题（源文件名） */
  title: string
  /** 文件扩展名（小写，不含点） */
  ext: string
  /** 编辑器宿主页 URL（webview 加载地址） */
  editorUrl: string
  /** DS 公网基址 */
  serverUrl: string
  startedAt: number
}

/** IPC 通道常量 */
export const OO_EDIT_CHANNELS = {
  /** 获取服务器配置（enabled/serverUrl/basePath，不含 adminKey） */
  CONFIG: 'oo-edit:get-config',
  /** 开始会话：上传本地文件 → 返回会话元信息 */
  START: 'oo-edit:start-session',
  /** 保存会话：force save → 下载 → 原子写回本地源文件 */
  SAVE: 'oo-edit:save-session',
  /** 放弃会话：删除网关远端副本 */
  DISCARD: 'oo-edit:discard-session',
} as const

/** ONLYOFFICE 可在线编辑的扩展名（主进程上传白名单 + 渲染层入口集合共用） */
export const OO_EDITABLE_EXTENSIONS = ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv'] as const
/** ONLYOFFICE 可在线编辑的扩展名类型 */
export type OoEditableExtension = (typeof OO_EDITABLE_EXTENSIONS)[number]

/* ---------------- Tab 路径辅助（kind='oo-edit'，仿 ppt-preview） ---------------- */

/** oo-edit Tab 路径前缀 */
export const OO_EDIT_PATH_PREFIX = 'oo-edit://session/'

/** 构建 oo-edit Tab 路径 */
export function buildOoEditPath(sessionId: string): string {
  return `${OO_EDIT_PATH_PREFIX}${sessionId}`
}

/** 判断路径是否为 oo-edit Tab */
export function isOoEditPath(path: string): boolean {
  return typeof path === 'string' && path.startsWith(OO_EDIT_PATH_PREFIX)
}

/** 从 oo-edit Tab 路径提取 sessionId */
export function extractSessionIdFromOoEditPath(path: string): string | null {
  if (!isOoEditPath(path)) return null
  return path.slice(OO_EDIT_PATH_PREFIX.length)
}

/* ---------------- 结果类型（preload/IPC 共享形状） ---------------- */

/** 统一响应基座：主进程 IPC 返回 { ok, error?, ...data } */
export interface OoIpcResult<T = Record<string, unknown>> {
  ok: boolean
  error?: string
  data?: T
}
