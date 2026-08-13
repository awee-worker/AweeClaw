/**
 * 垂直搜索 HTTP 工具函数
 *
 * 职责：
 * - 为垂直搜索模块提供轻量级 HTTPS/HTTP 请求能力
 * - 支持 JSON 解析、超时控制、自定义 headers
 * - 独立于 httpTransport.ts，避免循环依赖
 */

import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'

/** JSON 请求结果 */
export interface JsonFetchResult {
  success: boolean
  status: number
  data?: string
  error?: string
}

/**
 * 发起 JSON GET 请求
 *
 * @param urlStr 完整 URL
 * @param headers 请求头
 * @param timeoutMs 超时（毫秒）
 */
export function jsonGet(
  urlStr: string,
  headers: Record<string, string> = {},
  timeoutMs = 8000,
): Promise<JsonFetchResult> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlStr)
      const isHttps = parsed.protocol === 'https:'
      const lib = isHttps ? https : http
      const options: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/html, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...headers,
        },
        timeout: timeoutMs,
      }

      const req = lib.request(options, (res) => {
        // 处理重定向（最多 3 次）
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : `${parsed.protocol}//${parsed.host}${res.headers.location}`
          jsonGet(redirectUrl, headers, timeoutMs).then(resolve)
          return
        }

        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { data += chunk })
        res.on('end', () => resolve({ success: true, status: res.statusCode || 0, data }))
      })

      req.on('error', (error: Error) => resolve({ success: false, status: 0, error: error.message }))
      req.on('timeout', () => { req.destroy(); resolve({ success: false, status: 0, error: 'timeout' }) })
      req.end()
    } catch (err) {
      resolve({ success: false, status: 0, error: err instanceof Error ? err.message : String(err) })
    }
  })
}

/**
 * 简单 HTML 文本提取
 *
 * 移除 script/style/标签，提取纯文本，压缩空白
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
