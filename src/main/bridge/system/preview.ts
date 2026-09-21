/**
 * 内置预览桥接
 *
 * 职责：把本地静态文件映射成内置浏览器可直接加载的 http 地址。
 *
 * 内置浏览器的 webview 只接受 http/https 源，本地页面必须经由预览静态服务
 * （modules/preview/PreviewStaticServer）暴露；渲染进程不关心端口与目录登记，
 * 只拿一个可加载的 URL。
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import { safeIpcHandle } from '../core/ipcGuard'
import { previewStaticServer } from '../../modules/preview/PreviewStaticServer'

/** 可作为页面直接预览的扩展名（其余文件按目录入口处理） */
const PAGE_EXT = /\.(html?|svg)$/i

export function registerPreviewHandlers(): void {
    /**
     * 为一个本地文件（或目录）解析出内置浏览器可加载的地址
     *
     * @param localPath 绝对路径：页面文件返回同目录下的文件地址，目录返回其 index.html
     */
    safeIpcHandle('preview:resolveLocalUrl', async (_, localPath: unknown) => {
        if (typeof localPath !== 'string' || !localPath.trim()) {
            return { success: false, error: 'localPath is required' }
        }

        const target = path.resolve(localPath.trim())

        let stats: fs.Stats
        try {
            stats = await fs.promises.stat(target)
        } catch {
            return { success: false, error: `Path does not exist: ${target}` }
        }

        const isPageFile = stats.isFile() && PAGE_EXT.test(target)
        const isDirectory = stats.isDirectory()

        if (!isPageFile && !isDirectory) {
            return {
                success: false,
                error: `Not a previewable target (expect an .html file or a folder): ${target}`,
            }
        }

        const rootDir = isPageFile ? path.dirname(target) : target
        const origin = await previewStaticServer.registerRoot(rootDir)
        if (!origin) {
            return { success: false, error: `Preview root unavailable: ${rootDir}` }
        }

        const url = isPageFile
            ? `${origin}/${encodeURIComponent(path.basename(target))}`
            : `${origin}/`

        return { success: true, url }
    })
}
