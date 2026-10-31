/**
 * 界面壁纸 API — preload 侧桥接
 *
 * 渲染进程通过 window.electronAPI.wallpaper.* 调用：
 * - pick   选择本地图片并导入到壁纸目录
 * - list   列出已导入的壁纸
 * - remove 删除已导入的壁纸
 */
import { invoke } from '../ipcHelpers'

export interface WallpaperPickResult {
  ok: boolean
  /** 成功时的壁纸地址（wallpaper-asset://local/<fileName>） */
  url?: string
  fileName?: string
  /** 失败原因：canceled / unsupported-format / too-large / failed */
  reason?: string
}

export interface WallpaperFileInfo {
  fileName: string
  url: string
  size: number
}

export function createWallpaperApi() {
  return {
    pick: (): Promise<WallpaperPickResult> => invoke<WallpaperPickResult>('wallpaper:pick')(),
    list: (): Promise<WallpaperFileInfo[]> => invoke<WallpaperFileInfo[]>('wallpaper:list')(),
    remove: (url: string): Promise<boolean> => invoke<boolean>('wallpaper:remove')(url),
  }
}
