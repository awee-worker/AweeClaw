/**
 * IPC 安全包装器 — 主进程 IPC 通信基础设施
 *
 * 职责：
 * - 包装 `ipcMain.handle`，统一捕获异常并返回结构化错误响应
 * - 开发环境下校验返回值可序列化性，提前发现循环引用 / Native Binding 问题
 * - 提供中间件机制，允许在 handler 执行前进行权限校验、参数过滤等
 * - 提供 `IpcChannelGuard` 单例，支持频道级调用统计与速率限制
 *
 * 设计原则：
 * - 所有 IPC handler 必须通过 `safeIpcHandle` 注册，禁止直接调用 `ipcMain.handle`
 * - 错误响应统一使用 `IpcGuardResponse` 结构，渲染进程据此判断成功/失败
 * - 中间件按注册顺序执行，任一中间件返回 false 即终止请求
 */

import { app, ipcMain, IpcMainInvokeEvent } from 'electron'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { logger } from '@shared/toolkit/LogEngine'

// ─── 类型定义 ──────────────────────────────────────────────

/**
 * IPC 统一响应结构
 *
 * 所有通过 `safeIpcHandle` 注册的 handler，其返回值均会被包装或直接返回此结构。
 * 渲染进程应通过 `success` 字段判断请求是否成功。
 */
export interface IpcGuardResponse<T = unknown> {
    success: boolean
    data?: T
    error?: string
    code?: string
    scenario?: string
    timestamp?: number
}

/**
 * IPC 中间件函数签名
 *
 * @param channel IPC 频道名称
 * @param args    handler 接收的参数数组
 * @returns 是否允许请求继续执行（false 则终止）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- IPC 参数类型由调用方决定，包装器需保持参数类型协变
type IpcMiddleware = (channel: string, args: any[]) => boolean | Promise<boolean>

/** 频道调用统计信息 */
interface ChannelStats {
    calls: number
    errors: number
    lastCall: number
}

/** 频道速率限制配置 */
interface RateLimitConfig {
    maxPerMinute: number
    calls: number[]
}

// ─── 中间件管理 ────────────────────────────────────────────

const middlewares: IpcMiddleware[] = []

/**
 * 注册 IPC 中间件
 *
 * 中间件按注册顺序执行，任一中间件返回 false 即拒绝请求。
 * 适用于权限校验、参数过滤、审计日志等横切关注点。
 *
 * @param mw 中间件函数
 */
export function addIpcMiddleware(mw: IpcMiddleware): void {
    middlewares.push(mw)
}

/**
 * 移除已注册的 IPC 中间件
 *
 * @param mw 要移除的中间件函数引用
 */
export function removeIpcMiddleware(mw: IpcMiddleware): void {
    const idx = middlewares.indexOf(mw)
    if (idx >= 0) middlewares.splice(idx, 1)
}

/**
 * 依次执行所有中间件
 *
 * @param channel IPC 频道名称
 * @param args    handler 参数
 * @returns 所有中间件均通过时返回 true
 */
async function runMiddlewares(channel: string, args: unknown[]): Promise<boolean> {
    for (const mw of middlewares) {
        const allowed = await mw(channel, args)
        if (!allowed) return false
    }
    return true
}

// ─── 核心：safeIpcHandle ───────────────────────────────────

/** safeIpcHandle 可选配置 */
export interface SafeIpcHandleOptions {
    /** 日志域名称（缺省时自动从频道名前缀提取） */
    domain?: string
    /**
     * 每分钟最大调用次数（速率限制）。
     * 设为 0 或省略表示不限流。
     * 超出限制的请求将被拒绝并返回 ERR_IPC_RATE_LIMIT。
     */
    rateLimitPerMinute?: number
}

/**
 * 安全包装 `ipcMain.handle`
 *
 * 功能：
 * 1. 速率限制 — 通过 IpcChannelGuard 自动限流，防止频道被高频滥用
 * 2. 中间件拦截 — 执行前校验权限 / 过滤参数
 * 3. 异常捕获 — handler 抛出的任何错误均被捕获，转为结构化响应
 * 4. 序列化校验（仅开发环境）— 检测返回值是否可被 JSON 序列化
 * 5. 日志记录 — 按频道前缀自动路由到对应日志域
 * 6. 调用统计 — 每次调用自动记录到 IpcChannelGuard，供监控面板使用
 *
 * @param channel IPC 频道名称（约定格式：`domain:action`，如 `llm:chat`）
 * @param handler 实际的处理器函数
 * @param options 配置项（日志域、速率限制），或直接传字符串作为日志域（向后兼容）
 */
export function safeIpcHandle<T = unknown>(
    channel: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- IPC handler 参数类型由调用方决定，包装器需保持参数类型协变
    handler: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T,
    options?: string | SafeIpcHandleOptions
): void {
    // 向后兼容：第三个参数既可以是字符串（日志域）也可以是配置对象
    const opts: SafeIpcHandleOptions = typeof options === 'string'
        ? { domain: options }
        : (options ?? {})

    const logDomain = opts.domain || channel.split(':')[0] || 'ipc'
    const channelGuard = IpcChannelGuard.getInstance()

    // 注册时配置速率限制（若指定）
    if (opts.rateLimitPerMinute && opts.rateLimitPerMinute > 0) {
        channelGuard.setRateLimit(channel, opts.rateLimitPerMinute)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electron ipcMain.handle 的参数类型
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: any[]) => {
        try {
            // 0. 速率限制检查
            if (!channelGuard.checkRateLimit(channel)) {
                logger.ipc.warn(`[${channel}] Rate limit exceeded`)
                return {
                    success: false,
                    error: `Rate limit exceeded for channel: ${channel}`,
                    code: 'ERR_IPC_RATE_LIMIT',
                    timestamp: Date.now(),
                } satisfies IpcGuardResponse
            }

            // 1. 中间件拦截
            const middlewarePassed = await runMiddlewares(channel, args)
            if (!middlewarePassed) {
                logger.ipc.warn(`[${channel}] Blocked by middleware`)
                channelGuard.recordCall(channel, false)
                return {
                    success: false,
                    error: `Request blocked: ${channel}`,
                    code: 'ERR_IPC_BLOCKED',
                    timestamp: Date.now(),
                } satisfies IpcGuardResponse
            }

            // 2. 执行 handler
            const result = await handler(event, ...args)

            // 3. 开发环境序列化校验
            // 第三方包（MCP SDK、node-pty 等）可能返回包含循环引用或 Native Binding 的对象
            if (!app.isPackaged) {
                try {
                    JSON.stringify(result)
                } catch (serializeErr) {
                    const targetLogger = getLogger(logDomain)
                    targetLogger.error(`[${channel}] Unserializable return value:`, serializeErr)
                    channelGuard.recordCall(channel, false)

                    return {
                        success: false,
                        error: `IPC response serialization failed for ${channel}: ${(serializeErr as Error).message}`,
                        code: 'ERR_IPC_SERIALIZATION',
                        timestamp: Date.now(),
                    } satisfies IpcGuardResponse
                }
            }

            channelGuard.recordCall(channel, true)
            return result
        } catch (err) {
            // 4. 异常捕获并转为结构化响应
            const appError = toAppError(err)
            const targetLogger = getLogger(logDomain)
            targetLogger.error(`[${channel}] Unhandled error:`, appError)
            channelGuard.recordCall(channel, false)

            return {
                success: false,
                error: appError.message || `Unknown error in ${channel}`,
                code: appError.code || 'ERR_IPC_UNHANDLED',
                timestamp: Date.now(),
            } satisfies IpcGuardResponse
        }
    })
}

/**
 * 根据日志域名称获取对应的 logger 实例
 * 若指定域不存在则回退到通用 ipc logger
 */
function getLogger(domain: string) {
    const target = (logger as unknown as Record<string, unknown>)[domain] as
        | { error: (...args: unknown[]) => void }
        | undefined
    return target && typeof target.error === 'function' ? target : logger.ipc
}

// ─── IpcChannelGuard：频道级监控与限流 ────────────────────

/**
 * IPC 频道守卫（单例）
 *
 * 提供：
 * - 频道级调用统计（调用次数、错误次数、最后调用时间）
 * - 频道级速率限制（每分钟最大调用次数）
 *
 * 集成方式：`safeIpcHandle` 已自动调用 `checkRateLimit` / `recordCall`，
 * 注册 handler 时传入 `{ rateLimitPerMinute: N }` 即可启用限流。
 * 也可通过 `getInstance().setRateLimit(channel, N)` 在运行时动态配置。
 */
export class IpcChannelGuard {
    private static instance: IpcChannelGuard | null = null
    private readonly channelStats = new Map<string, ChannelStats>()
    private readonly rateLimits = new Map<string, RateLimitConfig>()

    /** 获取单例实例 */
    static getInstance(): IpcChannelGuard {
        if (!IpcChannelGuard.instance) {
            IpcChannelGuard.instance = new IpcChannelGuard()
        }
        return IpcChannelGuard.instance
    }

    /** 记录一次频道调用 */
    recordCall(channel: string, success: boolean): void {
        const stats = this.channelStats.get(channel) ?? { calls: 0, errors: 0, lastCall: 0 }
        stats.calls++
        if (!success) stats.errors++
        stats.lastCall = Date.now()
        this.channelStats.set(channel, stats)
    }

    /** 为指定频道设置速率限制 */
    setRateLimit(channel: string, maxPerMinute: number): void {
        this.rateLimits.set(channel, { maxPerMinute, calls: [] })
    }

    /**
     * 检查频道是否超出速率限制
     *
     * @returns true 表示允许调用，false 表示已被限流
     */
    checkRateLimit(channel: string): boolean {
        const limit = this.rateLimits.get(channel)
        if (!limit) return true

        const now = Date.now()
        // 清理 1 分钟前的调用记录
        limit.calls = limit.calls.filter(t => now - t < 60_000)
        if (limit.calls.length >= limit.maxPerMinute) return false

        limit.calls.push(now)
        return true
    }

    /** 获取指定频道的调用统计 */
    getStats(channel: string): ChannelStats | undefined {
        return this.channelStats.get(channel)
    }

    /** 获取所有频道的调用统计快照 */
    getAllStats(): Map<string, ChannelStats> {
        return new Map(this.channelStats)
    }
}
