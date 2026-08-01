/**
 * plugin-bundle 自定义协议
 *
 * 专为加载插件 UI 的 ESM bundle 设计。镜像 scenario-bundle 协议，
 * 关键差异：路径白名单更严——仅允许访问 userData/plugins/ 子树。
 *
 * 协议 URL 格式：
 *   plugin-bundle://localhost/absolute/path/to/ui.js
 *
 * 安全策略：
 * - 仅允许访问 app.getPath('userData')/plugins/ 目录及其子目录
 * - 阻止路径穿越（.. 越狱）
 * - 返回正确的 MIME 类型（application/javascript）
 *
 * 必须在 app.whenReady() 之前调用 registerPluginBundleScheme()，
 * 在 whenReady() 之后调用 registerPluginBundleHandler()。
 */
import { protocol, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

const SCHEME = 'plugin-bundle'

/**
 * 注册协议为 privileged（必须在 app ready 之前调用）
 *
 * standard: true 是让 dynamic import() 正常工作的关键。
 * bypassCSP: true 允许绕过 CSP 加载插件 bundle。
 */
export function registerPluginBundleScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        bypassCSP: true,
        allowServiceWorkers: false,
        supportFetchAPI: true,
        stream: true,
        standard: true,
        secure: true,
        corsEnabled: true,
      },
    },
  ])
}

/**
 * 解析插件根目录（userData/plugins）
 *
 * 延迟读取 app.getPath('userData')，确保在 app ready 后调用。
 */
function getPluginsRoot(): string {
  return path.join(app.getPath('userData'), 'plugins')
}

/**
 * 注册协议处理器（必须在 app ready 之后调用）
 *
 * 将 plugin-bundle:// 请求映射到本地文件系统路径，
 * 仅允许访问 userData/plugins/ 子树。
 */
export function registerPluginBundleHandler(): void {
  protocol.handle(SCHEME, (request) => {
    try {
      const url = new URL(request.url)

      // URL 格式：plugin-bundle://localhost/absolute/path/to/file
      let filePath = decodeURIComponent(url.pathname)

      // Windows 路径以 / 开头需剥离前导斜杠
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1)
      }

      if (!filePath) {
        return new Response('Bad Request: missing file path', { status: 400 })
      }

      const normalized = path.resolve(filePath)
      const pluginsRoot = path.resolve(getPluginsRoot())

      // 安全检查：路径必须在 pluginsRoot 子树内
      // path.relative 返回以 .. 开头表示路径在 pluginsRoot 之外
      const relative = path.relative(pluginsRoot, normalized)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return new Response('Forbidden: outside plugins directory', { status: 403 })
      }

      // 安全检查：文件必须存在
      if (!fs.existsSync(normalized)) {
        return new Response(`Not Found: ${path.basename(normalized)}`, { status: 404 })
      }

      // 读取文件内容并返回
      const fileBuffer = fs.readFileSync(normalized)

      // 根据文件扩展名确定 MIME 类型
      const ext = path.extname(normalized).toLowerCase()
      const mimeTypes: Record<string, string> = {
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.html': 'text/html',
      }
      const mimeType = mimeTypes[ext] || 'application/octet-stream'

      return new Response(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'no-cache',
        },
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return new Response(`Internal Server Error: ${errMsg}`, { status: 500 })
    }
  })
}
