/**
 * ONLYOFFICE 在线编辑 preload API
 *
 * 封装主进程 OoEditManager 的 IPC（render → main）：
 * - oo-edit:get-config        读取服务器配置（enabled/serverUrl/basePath）
 * - oo-edit:start-session     上传本地文件并创建编辑会话（返回 editorUrl）
 * - oo-edit:save-session      保存：force save → 下载 → 原子写回本地源文件
 * - oo-edit:discard-session   放弃：删除网关远端副本
 * - oo-edit:bind-shortcut     把编辑器里的 Cmd/Ctrl+S 接到渲染层保存
 * - oo-edit:read-selection    读取编辑器选区文本（AI 修改的上下文来源）
 * - oo-edit:replace-selection 把文本写回编辑器选区
 *
 * 设计要点：
 * - 管理密钥（adminKey）只在主进程使用，绝不下发到渲染层
 * - 本地文件读写全部在主进程完成，渲染层不接触文件字节
 */
import { invoke, onVoid } from '../ipcHelpers'
import {
  OO_EDIT_CHANNELS,
  type OoSelectionResult,
  type OnlyOfficeEditSessionMeta,
} from '../../../shared/protocols/onlyOfficeProtocol'

export interface OnlyOfficeServerInfo {
  enabled: boolean
  serverUrl: string
  basePath: string
}

export function createOnlyOfficeApi() {
  return {
    /** 获取服务器配置（enabled=false 表示用户在配置中显式禁用） */
    getConfig: invoke<OnlyOfficeServerInfo>(OO_EDIT_CHANNELS.CONFIG),

    /** 开始会话：上传本地文件，成功返回含 editorUrl 的会话元信息 */
    startSession: invoke<{ ok: boolean; error?: string; session?: OnlyOfficeEditSessionMeta }>(
      OO_EDIT_CHANNELS.START,
    ),

    /** 保存并回写本地：成功返回 { ok, size, sourcePath } */
    saveSession: invoke<{ ok: boolean; error?: string; size?: number; sourcePath?: string }>(
      OO_EDIT_CHANNELS.SAVE,
    ),

    /** 放弃会话：删除远端副本，不写回本地 */
    discardSession: invoke<{ ok: boolean; error?: string }>(OO_EDIT_CHANNELS.DISCARD),

    /** 刷新会话：源文件被外部更新后重新上传，保持同一 sessionId 与 Tab 身份 */
    refreshSession: invoke<{ ok: boolean; error?: string; session?: OnlyOfficeEditSessionMeta }>(
      OO_EDIT_CHANNELS.REFRESH,
    ),

    /**
     * 绑定编辑器快捷键
     *
     * 编辑器在 webview 的独立渲染进程里，宿主页面收不到它的按键；由主进程在
     * before-input-event 层拦住 Cmd/Ctrl+S，再回推 SAVE_SHORTCUT 事件。
     */
    bindSaveShortcut: invoke<{ ok: boolean; error?: string }>(OO_EDIT_CHANNELS.BIND_SHORTCUT),

    /** 编辑器内按下 Cmd/Ctrl+S 的通知订阅 */
    onSaveShortcut: onVoid(OO_EDIT_CHANNELS.SAVE_SHORTCUT),

    /** 读取编辑器当前选中内容（空字符串表示没有选中） */
    readSelection: invoke<OoSelectionResult>(OO_EDIT_CHANNELS.READ_SELECTION),

    /** 把文本粘贴进编辑器当前选区（等同用户手动粘贴） */
    replaceSelection: invoke<OoSelectionResult>(OO_EDIT_CHANNELS.REPLACE_SELECTION),
  }
}
