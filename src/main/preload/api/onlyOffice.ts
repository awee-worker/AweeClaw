/**
 * ONLYOFFICE 在线编辑 preload API
 *
 * 封装主进程 OoEditManager 的 IPC（render → main）：
 * - oo-edit:get-config        读取服务器配置（enabled/serverUrl/basePath）
 * - oo-edit:start-session     上传本地文件并创建编辑会话（返回 editorUrl）
 * - oo-edit:save-session      保存：force save → 下载 → 原子写回本地源文件
 * - oo-edit:discard-session   放弃：删除网关远端副本
 *
 * 设计要点：
 * - 管理密钥（adminKey）只在主进程使用，绝不下发到渲染层
 * - 本地文件读写全部在主进程完成，渲染层不接触文件字节
 */
import { invoke } from '../ipcHelpers'
import {
  OO_EDIT_CHANNELS,
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
  }
}
