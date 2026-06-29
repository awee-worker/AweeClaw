/**
 * local-preview 自定义协议
 *
 * 用于在渲染进程安全地访问本地文件（如 AI 生成的图片预览、知识库附件等），
 * 相比直接 file:// 协议，本协议：
 * 1. 显式注册为 privileged，支持 fetch API 与流式响应
 * 2. 拦截敏感系统目录的访问请求
 *
 * 必须在 app.whenReady() 之前调用 registerScheme()，
 * 在 whenReady() 之后调用 registerHandler()。
 */
import { app, net, protocol } from 'electron'
import * as path from 'path'

const SCHEME = 'local-preview'

/** 禁止访问的敏感系统目录 */
const SENSITIVE_PATHS = ['/etc', '/proc', '/sys', '/dev', 'C:\\Windows\\System32']

/** 注册协议为 privileged（必须在 app ready 之前调用） */
export function registerLocalPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        bypassCSP: true,
        allowServiceWorkers: false,
        supportFetchAPI: true,
        stream: true,
        standard: false,
        secure: true,
        corsEnabled: false,
      },
    },
  ])
}

/** 注册协议处理器（必须在 app ready 之后调用） */
export function registerLocalPreviewHandler(): void {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    let filePath = decodeURIComponent(url.pathname)

    // Windows 路径以 / 开头需剥离前导斜杠
    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1)
    }

    if (!filePath) {
      return new Response('Bad Request', { status: 400 })
    }

    const normalized = path.resolve(filePath)
    if (SENSITIVE_PATHS.some((s) => normalized.startsWith(s))) {
      return new Response('Forbidden', { status: 403 })
    }

    return net.fetch(`file://${normalized}`)
  })
}

/** 当前应用是否已就绪（用于在 registerHandler 调用前的防御性检查） */
export function isAppReady(): boolean {
  return app.isReady()
}
