/**
 * 内置预览静态服务
 *
 * 为什么需要它：内置浏览器的 webview 只接受 http/https 源（见 windowManager 的
 * webview 守卫），本地静态页面既不能走 file://，也不能走自定义协议。此前 AI 只能
 * 退化成 `python3 -m http.server` + 外部浏览器：终端里多出一个常驻会话，预览还落在
 * 应用之外。这里在主进程内维护一个仅监听回环地址的静态服务，把「预览本地页面」
 * 收敛成一次 IPC 调用。
 *
 * 安全边界：
 * - 只监听 127.0.0.1，端口由系统分配（不固定端口，避免被页面枚举）
 * - 只服务注册过根目录（被预览过的页面所在目录）内的文件，按相对路径解析并做越界校验
 * - 不提供目录列表；点开头的路径段（.env / .git / .ssh 等）一律拒绝
 * - 敏感系统目录不允许注册为根目录
 */

import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '@shared/toolkit/LogEngine'

/** 禁止作为预览根目录的系统位置（与 local-preview 协议一致） */
const SENSITIVE_ROOTS = ['/etc', '/proc', '/sys', '/dev', 'C:\\Windows\\System32']

/** 根目录数量上限：预览过的页面目录按最近使用排序保留 */
const MAX_ROOTS = 24

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.wasm': 'application/wasm',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
}

/** 路径是否落在敏感系统目录内 */
function isSensitiveRoot(dir: string): boolean {
    const normalized = path.resolve(dir)
    return SENSITIVE_ROOTS.some((root) => {
        const resolvedRoot = path.resolve(root)
        return normalized === resolvedRoot || normalized.startsWith(`${resolvedRoot}${path.sep}`)
    })
}

/** 请求路径是否含点开头的路径段（.env / .git / .ssh 等） */
function hasDotSegment(relativePath: string): boolean {
    return relativePath
        .split(/[\\/]/)
        .some((segment) => segment.startsWith('.') && segment !== '.' && segment !== '..')
}

class PreviewStaticServer {
    private server: http.Server | null = null
    private port = 0
    /** 已注册的预览根目录，最近使用的排在最前 */
    private roots: string[] = []
    private starting: Promise<number> | null = null

    /**
     * 登记一个预览根目录并返回服务源（origin）
     *
     * @param dir 目录绝对路径
     * @returns `http://127.0.0.1:<port>`；目录不可用时返回 null
     */
    async registerRoot(dir: string): Promise<string | null> {
        const resolved = path.resolve(dir)

        if (isSensitiveRoot(resolved)) {
            logger.system.warn('[PreviewServer] Refused sensitive root:', resolved)
            return null
        }

        let stats: fs.Stats
        try {
            stats = await fs.promises.stat(resolved)
        } catch {
            return null
        }
        if (!stats.isDirectory()) return null

        // 最近使用的排在最前，保证同名文件（如各项目的 /index.html）命中正确的那一份
        this.roots = [resolved, ...this.roots.filter((root) => root !== resolved)].slice(0, MAX_ROOTS)

        try {
            const port = await this.ensureStarted()
            return `http://127.0.0.1:${port}`
        } catch (err) {
            logger.system.error('[PreviewServer] Failed to start static server:', err)
            return null
        }
    }

    /** 关闭服务（应用退出时调用） */
    async dispose(): Promise<void> {
        const server = this.server
        this.server = null
        this.starting = null
        this.port = 0
        this.roots = []
        if (!server) return
        await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    private ensureStarted(): Promise<number> {
        if (this.server && this.port) return Promise.resolve(this.port)
        if (this.starting) return this.starting

        this.starting = new Promise<number>((resolve, reject) => {
            const server = http.createServer((req, res) => {
                void this.handleRequest(req, res)
            })

            server.on('error', (err) => {
                this.starting = null
                this.server = null
                reject(err)
            })

            // 只绑定回环地址：预览服务不该对局域网可见
            server.listen(0, '127.0.0.1', () => {
                const address = server.address()
                if (!address || typeof address === 'string') {
                    this.starting = null
                    server.close()
                    reject(new Error('Preview server address unavailable'))
                    return
                }
                this.server = server
                this.port = address.port
                logger.system.info(`[PreviewServer] Serving local preview at http://127.0.0.1:${address.port}`)
                resolve(address.port)
            })
        })

        return this.starting
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405).end('Method Not Allowed')
            return
        }

        let relativePath: string
        try {
            relativePath = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname)
        } catch {
            res.writeHead(400).end('Bad Request')
            return
        }

        const normalizedRelative = relativePath.replace(/^\/+/, '')
        if (normalizedRelative.includes('\0') || normalizedRelative.split(/[\\/]/).includes('..')) {
            res.writeHead(403).end('Forbidden')
            return
        }

        const target = await this.resolveTarget(normalizedRelative)
        if (!target) {
            res.writeHead(404).end('Not Found')
            return
        }

        try {
            const stats = await fs.promises.stat(target)
            if (!stats.isFile()) {
                res.writeHead(404).end('Not Found')
                return
            }

            const contentType = MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream'
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': stats.size,
                // 预览要即时反映 AI 刚写入的内容，禁用缓存
                'Cache-Control': 'no-store',
            })
            if (req.method === 'HEAD') {
                res.end()
                return
            }
            fs.createReadStream(target).pipe(res)
        } catch {
            res.writeHead(404).end('Not Found')
        }
    }

    /**
     * 把请求相对路径映射到磁盘文件
     *
     * 空路径按「预览根目录的 index.html」解析；其余路径依次在各根目录下查找，
     * 命中第一个真实存在的文件。既支持相对引用（style.css），也支持绝对引用（/style.css）。
     */
    private async resolveTarget(relativePath: string): Promise<string | null> {
        const candidates = this.roots.map((root) =>
            relativePath ? path.join(root, relativePath) : path.join(root, 'index.html'),
        )

        for (const candidate of candidates) {
            const resolved = path.resolve(candidate)
            // 越界校验：解析结果必须仍在某个注册根目录内
            const inside = this.roots.some((root) => {
                const resolvedRoot = path.resolve(root)
                return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)
            })
            if (!inside) continue
            if (hasDotSegment(path.relative(this.rootOf(resolved), resolved))) continue

            try {
                const stats = await fs.promises.stat(resolved)
                if (stats.isFile()) return resolved
            } catch {
                // 该根目录下不存在，继续尝试下一个
            }
        }

        return null
    }

    /** 找出某个绝对路径所属的注册根目录（用于计算相对路径） */
    private rootOf(target: string): string {
        return (
            this.roots.find((root) => {
                const resolvedRoot = path.resolve(root)
                return target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`)
            }) || this.roots[0] || path.dirname(target)
        )
    }
}

export const previewStaticServer = new PreviewStaticServer()
