/**
 * 页面健康监控测试
 *
 * 覆盖三类容易静默失效的判定逻辑：
 * 1. console-message 载荷归一化（Electron 新旧签名差异、info 级噪音过滤）
 * 2. 健康等级判定（告警 / 错误 / 崩溃的优先级）
 * 3. 白屏像素判定与资源瀑布解析的边界输入
 */

import { describe, it, expect, vi } from 'vitest'

// 模块 import 期会读 electron 的 webContents，node 环境下需要占位
vi.mock('electron', () => ({
    webContents: { fromId: () => undefined },
}))

import {
    computeHealthLevel,
    isBlankBitmap,
    normalizeConsolePayload,
    parseNetworkEntries,
    toConsoleLevel,
} from '../PreviewHealthMonitor'

/** 构造 BGRA 位图：入参为 [B, G, R, A] 四元组序列 */
function buildBitmap(pixels: Array<[number, number, number, number]>): Buffer {
    const buffer = Buffer.alloc(pixels.length * 4)
    pixels.forEach(([b, g, r, a], index) => {
        buffer[index * 4] = b
        buffer[index * 4 + 1] = g
        buffer[index * 4 + 2] = r
        buffer[index * 4 + 3] = a
    })
    return buffer
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255]
const BLACK: [number, number, number, number] = [0, 0, 0, 255]

describe('toConsoleLevel', () => {
    it('识别新签名的字符串级别', () => {
        expect(toConsoleLevel('error')).toBe('error')
        expect(toConsoleLevel('warning')).toBe('warning')
        expect(toConsoleLevel('warn')).toBe('warning')
    })

    it('识别旧签名的数字级别', () => {
        expect(toConsoleLevel(3)).toBe('error')
        expect(toConsoleLevel(2)).toBe('warning')
    })

    it('忽略 info 与 verbose 级噪音', () => {
        expect(toConsoleLevel('info')).toBeNull()
        expect(toConsoleLevel('verbose')).toBeNull()
        expect(toConsoleLevel(0)).toBeNull()
        expect(toConsoleLevel(1)).toBeNull()
    })

    it('非级别输入返回 null', () => {
        expect(toConsoleLevel(undefined)).toBeNull()
        expect(toConsoleLevel({})).toBeNull()
    })
})

describe('normalizeConsolePayload', () => {
    it('解析新签名 (event 已剔除, details 对象)', () => {
        const payload = normalizeConsolePayload([
            {
                level: 'error',
                message: 'Cannot read properties of undefined',
                lineNumber: 42,
                sourceId: 'http://127.0.0.1:5170/src/main.ts',
            },
        ])

        expect(payload).toEqual({
            level: 'error',
            message: 'Cannot read properties of undefined',
            line: 42,
            source: 'http://127.0.0.1:5170/src/main.ts',
        })
    })

    it('解析旧签名 (level, message, line, sourceId)', () => {
        const payload = normalizeConsolePayload([
            2,
            'deprecated api',
            7,
            'http://127.0.0.1:5170/app.js',
        ])

        expect(payload).toEqual({
            level: 'warning',
            message: 'deprecated api',
            line: 7,
            source: 'http://127.0.0.1:5170/app.js',
        })
    })

    it('缺少可选字段时回落到默认值', () => {
        const payload = normalizeConsolePayload([{ level: 'error', message: 'boom' }])

        expect(payload).toEqual({ level: 'error', message: 'boom', line: 0, source: '' })
    })

    it('过滤 info 级与空消息', () => {
        expect(normalizeConsolePayload([{ level: 'info', message: 'hello' }])).toBeNull()
        expect(normalizeConsolePayload([{ level: 'error', message: '' }])).toBeNull()
        expect(normalizeConsolePayload([])).toBeNull()
    })
})

describe('computeHealthLevel', () => {
    const consoleError = { level: 'error' as const, message: 'x', line: 1, source: 'a', at: 0, count: 1 }
    const consoleWarning = { level: 'warning' as const, message: 'x', line: 1, source: 'a', at: 0, count: 1 }
    const failure = { url: 'http://x/a.js', errorCode: 0, errorDescription: 'FAILED', at: 0 }

    it('无任何异常时为 healthy', () => {
        expect(
            computeHealthLevel({
                crashed: false,
                loadFailures: [],
                consoleMessages: [],
                blank: false,
            }),
        ).toBe('healthy')
    })

    it('只有告警或白屏时为 warning', () => {
        expect(
            computeHealthLevel({
                crashed: false,
                loadFailures: [],
                consoleMessages: [consoleWarning],
                blank: false,
            }),
        ).toBe('warning')

        expect(
            computeHealthLevel({
                crashed: false,
                loadFailures: [],
                consoleMessages: [],
                blank: true,
            }),
        ).toBe('warning')
    })

    it('控制台错误 / 加载失败 / 崩溃任一出现即为 error', () => {
        expect(
            computeHealthLevel({
                crashed: false,
                loadFailures: [],
                consoleMessages: [consoleError],
                blank: false,
            }),
        ).toBe('error')

        expect(
            computeHealthLevel({
                crashed: false,
                loadFailures: [failure],
                consoleMessages: [],
                blank: false,
            }),
        ).toBe('error')

        expect(
            computeHealthLevel({
                crashed: true,
                loadFailures: [],
                consoleMessages: [],
                blank: true,
            }),
        ).toBe('error')
    })
})

describe('isBlankBitmap', () => {
    it('整幅同色判定为空白', () => {
        expect(isBlankBitmap(buildBitmap(Array(1600).fill(WHITE)))).toBe(true)
    })

    it('出现可见内容时不判定为空白', () => {
        const pixels: Array<[number, number, number, number]> = [
            ...Array(100).fill(WHITE),
            ...Array(1500).fill(BLACK),
        ]
        expect(isBlankBitmap(buildBitmap(pixels))).toBe(false)
    })

    it('容差内的轻微色差仍视为空白', () => {
        // 通道差值均在容差(6)以内
        const nearWhite: [number, number, number, number] = [252, 253, 250, 255]
        expect(isBlankBitmap(buildBitmap(Array(1600).fill(nearWhite)))).toBe(true)
    })

    it('空位图不判定为空白', () => {
        expect(isBlankBitmap(Buffer.alloc(0))).toBe(false)
    })
})

describe('parseNetworkEntries', () => {
    it('解析合法资源瀑布', () => {
        const raw = JSON.stringify([
            { url: 'http://127.0.0.1:5170/main.js', type: 'script', duration: 12, size: 2048, status: 200 },
        ])

        expect(parseNetworkEntries(raw)).toEqual([
            { url: 'http://127.0.0.1:5170/main.js', type: 'script', duration: 12, size: 2048, status: 200 },
        ])
    })

    it('非法输入返回空数组', () => {
        expect(parseNetworkEntries('not json')).toEqual([])
        expect(parseNetworkEntries('{"a":1}')).toEqual([])
        expect(parseNetworkEntries(undefined)).toEqual([])
        expect(parseNetworkEntries(null)).toEqual([])
    })

    it('丢弃缺少地址的条目并补默认字段', () => {
        const raw = JSON.stringify([{ type: 'img' }, { url: 'http://x/a.css' }])

        expect(parseNetworkEntries(raw)).toEqual([
            { url: 'http://x/a.css', type: 'other', duration: 0, size: 0, status: 0 },
        ])
    })
})
