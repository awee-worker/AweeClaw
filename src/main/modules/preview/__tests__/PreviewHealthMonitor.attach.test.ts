/**
 * 页面健康监控：绑定与推送时序测试
 *
 * 两条约束都是「不推就等于没数据」的静默失效，容易被后续改动破坏：
 * 1. attach 之后必须立刻推一次初始快照——没有任何告警的干净页面不会再有变更事件
 * 2. 白屏采样结束时必须推一次，且不能只在结果翻转时才推；页面正常也需要外显
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** 探针可控的 guest 注册表：electron 模块被 mock，由用例填值 */
const state = vi.hoisted(() => ({
    guests: new Map<number, unknown>(),
}))

vi.mock('electron', () => ({
    webContents: {
        fromId: (id: number) => state.guests.get(id) ?? undefined,
    },
}))

import { PREVIEW_HEALTH_CHANNEL, type PreviewHealthSnapshot } from '@shared/protocols/previewProtocol'
import { previewHealthMonitor } from '../PreviewHealthMonitor'

/** 最小可用的 guest 替身：聚合事件与页面能力 */
function createGuest(id: number, bitmap: Buffer) {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>()

    return {
        id,
        isDestroyed: () => false,
        getTitle: () => 'preview',
        session: { webRequest: { onErrorOccurred: () => undefined } },
        on(event: string, handler: (...args: unknown[]) => void) {
            const list = listeners.get(event) ?? []
            list.push(handler)
            listeners.set(event, list)
        },
        removeListener(event: string, handler: (...args: unknown[]) => void) {
            const list = listeners.get(event) ?? []
            listeners.set(
                event,
                list.filter((item) => item !== handler),
            )
        },
        capturePage: async () => ({
            isEmpty: () => false,
            resize: () => ({ toBitmap: () => bitmap }),
        }),
        emit(event: string, ...args: unknown[]) {
            ;(listeners.get(event) ?? []).forEach((handler) => handler(...args))
        },
    }
}

/** 半幅白、半幅黑的位图：不构成白屏 */
function mixedBitmap(): Buffer {
    const buffer = Buffer.alloc(40 * 40 * 4)
    for (let i = 0; i < 800; i += 1) {
        const offset = i * 4
        buffer[offset] = 255
        buffer[offset + 1] = 255
        buffer[offset + 2] = 255
        buffer[offset + 3] = 255
    }
    return buffer
}

function createOwner() {
    const snapshots: PreviewHealthSnapshot[] = []
    return {
        snapshots,
        isDestroyed: () => false,
        send: (channel: string, snapshot: PreviewHealthSnapshot) => {
            if (channel === PREVIEW_HEALTH_CHANNEL) snapshots.push(snapshot)
        },
    }
}

describe('PreviewHealthMonitor 绑定与推送', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        previewHealthMonitor.dispose()
        state.guests.clear()
        vi.useRealTimers()
    })

    it('绑定后立刻推送一次初始快照（干净页面也不会没有数据）', async () => {
        const guest = createGuest(101, mixedBitmap())
        const owner = createOwner()
        state.guests.set(guest.id, guest)

        const initial = previewHealthMonitor.attach(
            guest.id,
            'session-clean',
            'http://127.0.0.1:5200/index.html',
            owner as never,
        )

        expect(initial?.level).toBe('healthy')

        // 推送有节拍，走完一拍才发 IPC
        await vi.advanceTimersByTimeAsync(300)

        expect(owner.snapshots).toHaveLength(1)
        expect(owner.snapshots[0].sessionId).toBe('session-clean')
        expect(owner.snapshots[0].level).toBe('healthy')
    })

    it('加载完成后的白屏采样即使结果未翻转也会推送', async () => {
        const guest = createGuest(102, mixedBitmap())
        const owner = createOwner()
        state.guests.set(guest.id, guest)

        previewHealthMonitor.attach(
            guest.id,
            'session-blank',
            'http://127.0.0.1:5201/index.html',
            owner as never,
        )
        await vi.advanceTimersByTimeAsync(300)
        owner.snapshots.length = 0

        guest.emit('did-finish-load')
        // 采样延迟 700ms + 推送节拍 250ms
        await vi.advanceTimersByTimeAsync(1200)

        expect(owner.snapshots.length).toBeGreaterThan(0)
        expect(owner.snapshots[0].blank).toBe(false)
    })

    it('解绑后不再推送', async () => {
        const guest = createGuest(103, mixedBitmap())
        const owner = createOwner()
        state.guests.set(guest.id, guest)

        previewHealthMonitor.attach(
            guest.id,
            'session-detach',
            'http://127.0.0.1:5202/index.html',
            owner as never,
        )
        previewHealthMonitor.detach(guest.id)
        await vi.advanceTimersByTimeAsync(500)

        expect(owner.snapshots).toHaveLength(0)
        expect(previewHealthMonitor.getSnapshot('session-detach')).toBeNull()
    })
})
