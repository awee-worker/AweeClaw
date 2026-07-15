/**
 * 剪贴板 API
 *
 * 覆盖 IPC 频道：
 * - clipboard:getFilePaths       读取原生剪贴板中的文件路径列表
 * - clipboard:hasFiles           快速检测剪贴板是否包含文件
 * - clipboard:getFileAttachments  读取文件并返回完整附件数据（base64 + 元信息）
 *
 * 方法名采用 getClipboard* / hasClipboard* 前缀，与其他 file/system API 命名一致，
 * 避免与渲染进程其他模块的同名方法冲突。
 */

import { invoke } from '../ipcHelpers'

export function createClipboardApi() {
  return {
    // 读取剪贴板中的文件路径列表（绝对路径）
    getClipboardFilePaths: () => invoke<string[]>('clipboard:getFilePaths')(),
    // 快速检测剪贴板是否包含文件（不解析路径，用于渲染进程决定是否 preventDefault）
    hasClipboardFiles: () => invoke<boolean>('clipboard:hasFiles')(),
    // 读取剪贴板中的文件并返回完整附件数据（base64 + 元信息）
    // 绕过工作区安全检查，适用于用户主动粘贴的文件
    getClipboardFileAttachments: () => invoke<unknown[]>('clipboard:getFileAttachments')(),
  }
}
