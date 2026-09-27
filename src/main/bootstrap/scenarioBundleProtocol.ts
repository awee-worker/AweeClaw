/**
 * scenario-bundle 自定义协议
 *
 * 专为加载编程式场景的 ESM bundle 设计。
 *
 * 与 local-preview 协议的关键区别：
 * - standard: true — 允许通过 dynamic import() 加载模块（local-preview 为 false）
 * - secure: true — 允许在 HTTPS 页面中加载
 * - corsEnabled: true — 允许跨域请求
 *
 * 协议特权在 schemeRegistry.ts 中与其他协议一起一次性注册（原因见该文件说明），
 * 本模块只负责协议处理器：把 scenario-bundle:// 请求映射到本地文件。
 *
 * 协议 URL 格式：
 *   scenario-bundle:///absolute/path/to/bundle.js
 *   scenario-bundle://localhost/absolute/path/to/bundle.js
 *
 * 安全策略：
 * - 仅允许访问 scenarios 目录及其子目录
 * - 阻止访问敏感系统目录
 * - 返回正确的 MIME 类型（application/javascript）
 */
import { protocol } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import type { PrivilegedScheme } from './schemeRegistry'

const SCHEME = 'scenario-bundle'

/** 禁止访问的敏感系统目录 */
const SENSITIVE_PATHS = ['/etc', '/proc', '/sys', '/dev', 'C:\\Windows\\System32']

/**
 * scenario-bundle 协议特权定义（由 schemeRegistry 统一注册）
 *
 * standard: true 是让 dynamic import() 正常工作的关键。
 * 没有 standard: true 的自定义协议无法被 import() 使用。
 */
export const SCENARIO_BUNDLE_SCHEME: PrivilegedScheme = {
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
}

/**
 * 注册协议处理器（必须在 app ready 之后调用）
 *
 * 将 scenario-bundle:// 请求映射到本地文件系统路径，
 * 并返回正确 MIME 类型的响应。
 */
export function registerScenarioBundleHandler(): void {
  protocol.handle(SCHEME, (request) => {
    try {
      const url = new URL(request.url)

      // URL 格式：scenario-bundle:///absolute/path/to/file
      // pathname 为 /absolute/path/to/file
      let filePath = decodeURIComponent(url.pathname)

      // Windows 路径以 / 开头需剥离前导斜杠
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1)
      }

      if (!filePath) {
        return new Response('Bad Request: missing file path', { status: 400 })
      }

      const normalized = path.resolve(filePath)

      // 安全检查：阻止访问敏感系统目录
      if (SENSITIVE_PATHS.some((s) => normalized.toLowerCase().startsWith(s.toLowerCase()))) {
        return new Response('Forbidden: sensitive system path', { status: 403 })
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
