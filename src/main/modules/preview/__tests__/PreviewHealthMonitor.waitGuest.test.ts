/**
 * 页面健康监控：预览会话等待窗口测试
 *
 * 打开页面与 guest 上报之间存在时间差，等待窗口就是这个时间差的收敛点。
 * 三条边界都必须成立，否则会退化成「第一次调用必然失败」或「永远等下去」：
 * 1. 已有会话时立即返回，不白等
 * 2. 会话稍后登记上来，能被等到
 * 3. 窗口内始终没有，按时返回 null 交回调用方
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

import { previewHealthMonitor } from '../PreviewHealthMonitor'

/** 最小可用的 guest 替身：等待窗口只关心 id 与标题 */
function createGuest(id: number) {
    return {
        id,
        isDestroyed: () => false,
        getTitle: () => 'preview',
        session: { webRequest: { onErrorOccurred: () => undefined } },
        on: () => undefined,
        removeListener: () => undefined,
    }
}

function createOwner() {
    return {
        isDestroyed: () => false,
        send: () => undefined,
    }
}

describe('PreviewHealthMonitor 等待预览会话', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        previewHealthMonitor.dispose()
        state.guests.clear()
        vi.useRealTimers()
    })

    it('已有预览会话时立即返回，不进入等待', async () => {
        const guest = createGuest(201)
        state.guests.set(guest.id, guest)
        previewHealthMonitor.attach(guest.id, 'session-ready', 'http://127.0.0.1:5300/', createOwner() as never)

        const resolved = await previewHealthMonitor.waitForGuest({}, 1000, 100)

        expect(resolved?.sessionId).toBe('session-ready')
        expect(resolved?.guestId).toBe(201)
    })

    it('窗口内登记上来的会话会被等到', async () => {
        const pending = previewHealthMonitor.waitForGuest({}, 1000, 100)

        // 调用发生在登记之前：这正是「刚打开就调用」的时序
        const guest = createGuest(202)
        state.guests.set(guest.id, guest)
        previewHealthMonitor.attach(guest.id, 'session-late', 'http://127.0.0.1:5301/', createOwner() as never)

        await vi.advanceTimersByTimeAsync(200)
        const resolved = await pending

        expect(resolved?.sessionId).toBe('session-late')
    })

    it('按 sessionId 过滤：不匹配的会话不会顶替目标', async () => {
        const guest = createGuest(203)
        state.guests.set(guest.id, guest)
        previewHealthMonitor.attach(guest.id, 'session-other', 'http://127.0.0.1:5302/', createOwner() as never)

        const pending = previewHealthMonitor.waitForGuest({ sessionId: 'session-target' }, 300, 100)
        await vi.advanceTimersByTimeAsync(500)

        expect(await pending).toBeNull()
    })

    it('窗口内始终没有会话时返回 null', async () => {
        const pending = previewHealthMonitor.waitForGuest({}, 300, 100)
        await vi.advanceTimersByTimeAsync(500)

        expect(await pending).toBeNull()
    })
})
