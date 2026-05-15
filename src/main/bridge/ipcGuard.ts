import { app, ipcMain, IpcMainInvokeEvent } from 'electron'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { logger } from '@shared/toolkit/LogEngine'

export interface IpcGuardResponse<T = unknown> {
    success: boolean
    data?: T
    error?: string
    code?: string
    scenario?: string
    timestamp?: number
}

type IpcMiddleware = (channel: string, args: any[]) => boolean | Promise<boolean>

const middlewares: IpcMiddleware[] = []

export function addIpcMiddleware(mw: IpcMiddleware) {
    middlewares.push(mw)
}

export function removeIpcMiddleware(mw: IpcMiddleware) {
    const idx = middlewares.indexOf(mw)
    if (idx >= 0) middlewares.splice(idx, 1)
}

async function runMiddlewares(channel: string, args: any[]): Promise<boolean> {
    for (const mw of middlewares) {
        const allowed = await mw(channel, args)
        if (!allowed) return false
    }
    return true
}

export function safeIpcHandle<T = unknown>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T,
    domain?: string
) {
    const logDomain = domain || channel.split(':')[0] || 'ipc'

    ipcMain.handle(channel, async (event, ...args) => {
        try {
            const middlewarePassed = await runMiddlewares(channel, args)
            if (!middlewarePassed) {
                logger.ipc.warn(`[${channel}] Blocked by middleware`)
                return {
                    success: false,
                    error: `Request blocked: ${channel}`,
                    code: 'ERR_IPC_BLOCKED',
                    timestamp: Date.now(),
                }
            }

            const result = await handler(event, ...args)

            if (!app.isPackaged) {
                try {
                    JSON.stringify(result)
                } catch (serializeErr) {
                    const targetLogger = (logger as any)[logDomain] || logger.ipc
                    if (targetLogger && targetLogger.error) {
                        targetLogger.error(`[${channel}] Unserializable return value:`, serializeErr)
                    } else {
                        logger.ipc.error(`[${channel}] Unserializable return value:`, serializeErr)
                    }

                    return {
                        success: false,
                        error: `IPC response serialization failed for ${channel}: ${(serializeErr as Error).message}`,
                        code: 'ERR_IPC_SERIALIZATION',
                        timestamp: Date.now(),
                    }
                }
            }

            return result
        } catch (err) {
            const appError = toAppError(err)
            const targetLogger = (logger as any)[logDomain] || logger.ipc

            if (targetLogger && targetLogger.error) {
                targetLogger.error(`[${channel}] Unhandled error:`, appError)
            } else {
                logger.ipc.error(`[${channel}] Unhandled error:`, appError)
            }

            return {
                success: false,
                error: appError.message || `Unknown error in ${channel}`,
                code: appError.code || 'ERR_IPC_UNHANDLED',
                timestamp: Date.now(),
            }
        }
    })
}

export class IpcChannelGuard {
    private static instance: IpcChannelGuard
    private channelStats = new Map<string, { calls: number; errors: number; lastCall: number }>()
    private rateLimits = new Map<string, { maxPerMinute: number; calls: number[] }>()

    static getInstance(): IpcChannelGuard {
        if (!IpcChannelGuard.instance) {
            IpcChannelGuard.instance = new IpcChannelGuard()
        }
        return IpcChannelGuard.instance
    }

    recordCall(channel: string, success: boolean): void {
        const stats = this.channelStats.get(channel) || { calls: 0, errors: 0, lastCall: 0 }
        stats.calls++
        if (!success) stats.errors++
        stats.lastCall = Date.now()
        this.channelStats.set(channel, stats)
    }

    setRateLimit(channel: string, maxPerMinute: number): void {
        this.rateLimits.set(channel, { maxPerMinute, calls: [] })
    }

    checkRateLimit(channel: string): boolean {
        const limit = this.rateLimits.get(channel)
        if (!limit) return true

        const now = Date.now()
        limit.calls = limit.calls.filter(t => now - t < 60000)
        if (limit.calls.length >= limit.maxPerMinute) return false

        limit.calls.push(now)
        return true
    }

    getStats(channel: string): { calls: number; errors: number; lastCall: number } | undefined {
        return this.channelStats.get(channel)
    }

    getAllStats(): Map<string, { calls: number; errors: number; lastCall: number }> {
        return new Map(this.channelStats)
    }
}
