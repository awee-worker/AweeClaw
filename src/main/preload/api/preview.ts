/**
 * 内置预览 API
 *
 * 覆盖 IPC 频道：
 * - preview:resolveLocalUrl  本地静态文件 → 内置浏览器可加载的 http 地址
 */
import { invoke } from '../ipcHelpers'

export function createPreviewApi() {
  return {
    /**
     * 把本地文件（或目录）解析成内置浏览器可加载的地址
     *
     * @param localPath 绝对路径
     */
    resolveLocalUrl: (localPath: string) =>
      invoke<{ success: boolean; url?: string; error?: string }>('preview:resolveLocalUrl')(localPath),
  }
}
