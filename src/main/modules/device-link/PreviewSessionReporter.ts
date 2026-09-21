/**
 * 预览会话快照上报（移动端接力）
 *
 * 把桌面端正在预览的页面推给移动端：手机上就能看到「电脑上开着哪些预览、页面是否正常」，
 * 不用开远程桌面就能判断要不要回去处理。
 *
 * 数据取自页面健康监控：它已经按 webview 维护了地址、健康状态与控制台错误，这里只做
 * 采样、去重和上报。
 *
 * 用固定节拍采样而不是订阅变化：dev server 报错时健康状态一秒能变几十次，而上报频率
 * 远不需要那么高；采样同时避免了与监控模块互相引用。
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { PreviewHealthSnapshot } from '@shared/protocols/previewProtocol'
import { previewHealthMonitor } from '../preview/PreviewHealthMonitor'
import { getDeviceLinkClient } from './DeviceLinkClient'

/** 采样节拍 */
const SAMPLE_INTERVAL_MS = 5000

/** 上报给移动端的单条会话摘要 */
interface PreviewSessionSummary {
    sessionId: string
    url: string
    title?: string
    level: PreviewHealthSnapshot['level']
    blank: boolean
    crashed: boolean
    consoleErrors: number
    loadFailures: number
    updatedAt: number
}

/** 会话摘要的比对指纹：内容未变就不重复上报 */
function fingerprintOf(sessions: PreviewSessionSummary[]): string {
    return JSON.stringify(
        sessions.map((session) => [
            session.sessionId,
            session.url,
            session.title,
            session.level,
            session.blank,
            session.crashed,
            session.consoleErrors,
            session.loadFailures,
        ]),
    )
}

function toSummary(snapshot: PreviewHealthSnapshot): PreviewSessionSummary {
    return {
        sessionId: snapshot.sessionId,
        url: snapshot.url,
        title: snapshot.title,
        level: snapshot.level,
        blank: snapshot.blank,
        crashed: snapshot.crashed,
        consoleErrors: snapshot.consoleMessages.length,
        loadFailures: snapshot.loadFailures.length,
        updatedAt: snapshot.updatedAt,
    }
}

class PreviewSessionReporter {
    private timer: ReturnType<typeof setInterval> | null = null
    /** 上一次上报的指纹；空串表示当前没有预览 */
    private lastFingerprint = ''

    /** 随设备联动一起启动 */
    attach(): void {
        if (this.timer) return
        this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS)
    }

    /** 应用退出 / 断开联动时停止 */
    detach(): void {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
        this.lastFingerprint = ''
    }

    private sample(): void {
        const summaries = previewHealthMonitor.listSnapshots().map(toSummary)

        if (summaries.length === 0) {
            // 预览全关时只在「上一次还有预览」的情况下补一条空快照，其余节拍静默
            if (this.lastFingerprint) {
                this.lastFingerprint = ''
                this.report([])
            }
            return
        }

        const fingerprint = fingerprintOf(summaries)
        if (fingerprint === this.lastFingerprint) return

        this.lastFingerprint = fingerprint
        this.report(summaries)
    }

    private report(sessions: PreviewSessionSummary[]): void {
        const client = getDeviceLinkClient()
        if (!client) return

        try {
            client.reportEvent('preview-session', { sessions })
        } catch (err) {
            logger.deviceLink.warn(`[PreviewSessionReporter] Failed to report: ${(err as Error).message}`)
        }
    }
}

export const previewSessionReporter = new PreviewSessionReporter()
