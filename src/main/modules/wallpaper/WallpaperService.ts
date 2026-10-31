/**
 * 界面壁纸资源服务（主进程）
 *
 * 为什么需要主进程参与：
 * 1. 用户选择的本地图片不能直接以 file:// 交给渲染进程 —— 生产环境页面通过
 *    loadFile 加载，origin 为 file://，Chromium 会拦截页面发起的 file:// 子资源；
 *    统一走自定义协议代理，行为与开发环境的 http 一致。
 * 2. 图片需要落盘保存。把 base64 塞进配置存储会让 electron-store 文件迅速膨胀，
 *    也会拖慢每次配置读取。
 *
 * 存储布局：<userData>/wallpapers/<fileName>，文件名由本模块生成，不接受外部传入路径。
 */
import { app, dialog, ipcMain, net, protocol, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { logger } from '@shared/toolkit/LogEngine'
import type { PrivilegedScheme } from '../../bootstrap/schemeRegistry'

/** 壁纸资源协议 */
export const WALLPAPER_SCHEME = 'wallpaper-asset'

/** 协议特权定义，由 bootstrap/schemeRegistry.ts 统一注册 */
export const WALLPAPER_SCHEME_DEF: PrivilegedScheme = {
  scheme: WALLPAPER_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    bypassCSP: true,
  },
}

/** 允许导入的图片扩展名 */
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp']

/** 单张壁纸体积上限（30MB）：超过这个尺寸做背景图没有意义，只会拖慢首帧 */
const MAX_WALLPAPER_BYTES = 30 * 1024 * 1024

/** 壁纸目录 */
export function getWallpaperDir(): string {
  const dir = path.join(app.getPath('userData'), 'wallpapers')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 生成渲染进程可直接使用的壁纸地址 */
function toWallpaperUrl(fileName: string): string {
  return `${WALLPAPER_SCHEME}://local/${encodeURIComponent(fileName)}`
}

/**
 * 把壁纸地址还原成磁盘路径。
 * 只允许本模块生成的裸文件名，任何带路径分隔符的输入一律拒绝。
 */
function resolveWallpaperFile(urlOrName: string): string | null {
  let fileName = urlOrName
  if (fileName.startsWith(`${WALLPAPER_SCHEME}://`)) {
    try {
      const parsed = new URL(fileName)
      fileName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
    } catch {
      return null
    }
  }
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    return null
  }
  const dir = getWallpaperDir()
  const full = path.join(dir, fileName)
  if (!full.startsWith(dir + path.sep)) return null
  if (!ALLOWED_EXTENSIONS.includes(path.extname(full).toLowerCase())) return null
  return fs.existsSync(full) ? full : null
}

/** 列出已导入的壁纸 */
export function listWallpapers(): { fileName: string; url: string; size: number }[] {
  try {
    const dir = getWallpaperDir()
    return fs
      .readdirSync(dir)
      .filter(name => ALLOWED_EXTENSIONS.includes(path.extname(name).toLowerCase()))
      .map(name => {
        const full = path.join(dir, name)
        let size = 0
        try {
          size = fs.statSync(full).size
        } catch {
          size = 0
        }
        return { fileName: name, url: toWallpaperUrl(name), size }
      })
      .sort((a, b) => b.fileName.localeCompare(a.fileName))
  } catch (err) {
    logger.system.warn('[Wallpaper] list failed:', err)
    return []
  }
}

/**
 * 打开文件对话框导入本地图片。
 * 选中后复制到壁纸目录，避免用户原文件被移动/删除后背景失效。
 */
export async function importWallpaper(parent?: BrowserWindow | null): Promise<
  { ok: true; url: string; fileName: string } | { ok: false; reason: string }
> {
  try {
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          title: '选择背景图片',
          properties: ['openFile'],
          filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
        })
      : await dialog.showOpenDialog({
          title: '选择背景图片',
          properties: ['openFile'],
          filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
        })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, reason: 'canceled' }
    }

    const source = result.filePaths[0]
    const ext = path.extname(source).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return { ok: false, reason: 'unsupported-format' }
    }

    const stat = fs.statSync(source)
    if (stat.size > MAX_WALLPAPER_BYTES) {
      return { ok: false, reason: 'too-large' }
    }

    const fileName = `wp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    fs.copyFileSync(source, path.join(getWallpaperDir(), fileName))
    logger.system.info('[Wallpaper] Imported:', fileName)
    return { ok: true, url: toWallpaperUrl(fileName), fileName }
  } catch (err) {
    logger.system.warn('[Wallpaper] import failed:', err)
    return { ok: false, reason: 'failed' }
  }
}

/** 删除已导入的壁纸 */
export function removeWallpaper(urlOrName: string): boolean {
  const full = resolveWallpaperFile(urlOrName)
  if (!full) return false
  try {
    fs.unlinkSync(full)
    return true
  } catch (err) {
    logger.system.warn('[Wallpaper] remove failed:', err)
    return false
  }
}

/**
 * 挂载 wallpaper-asset:// 协议（必须在 app ready 之后调用）。
 *
 * URL 形式：wallpaper-asset://local/<encodeURIComponent(fileName)>
 * host 固定为 local，文件名只允许落在壁纸目录内。
 */
export function handleWallpaperProtocol(): void {
  try {
    protocol.handle(WALLPAPER_SCHEME, async request => {
      try {
        const full = resolveWallpaperFile(request.url)
        if (!full) {
          return new Response('Not found', { status: 404 })
        }
        return await net.fetch(pathToFileURL(full).toString())
      } catch (err) {
        logger.system.warn('[Wallpaper] protocol error:', err)
        return new Response('Bad request', { status: 400 })
      }
    })
    logger.system.info('[Wallpaper] Protocol mounted:', WALLPAPER_SCHEME)
  } catch (err) {
    logger.system.warn('[Wallpaper] protocol.handle failed:', err)
  }
}

/** 注册壁纸相关 IPC */
export function registerWallpaperIpc(): void {
  ipcMain.handle('wallpaper:pick', async event => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return importWallpaper(win)
  })

  ipcMain.handle('wallpaper:list', () => listWallpapers())

  ipcMain.handle('wallpaper:remove', (_event, urlOrName: string) => {
    return removeWallpaper(String(urlOrName || ''))
  })
}
