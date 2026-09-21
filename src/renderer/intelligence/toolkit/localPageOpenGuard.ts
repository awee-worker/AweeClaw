/**
 * 「用系统浏览器打开本地页面」命令识别
 *
 * 为什么需要：让用户看到刚生成的页面这一步，模型很容易沿用外部习惯——
 * `open index.html`（macOS）/ `start index.html`（Windows）/ `xdg-open`（Linux）。
 * 这类命令把预览留在应用之外，而且在嵌入了自动化栈的环境里常常直接失败
 * （file: 协议被拦截），失败后模型往往再起一个 `python3 -m http.server` 兜底，
 * 于是终端里多出一个需要用户手动停掉的常驻进程。
 *
 * 本模块只做「识别」这一件事，命中后由执行层改走内置浏览器（见 toolExecutors.run_command）。
 * 判定刻意收窄到三类目标，避免误伤正常的文件打开操作：
 * 1. 本地页面文件（.html / .htm 且真实存在）
 * 2. file:// 形式的本地页面
 * 3. 回环地址上的 http 服务（localhost / 127.0.0.1）
 * 目录、文档、应用等目标一律不拦截。
 */

import { resolveToAbsolute } from '@shared/toolkit/pathHelper'

/** 打开工具：macOS open / Linux xdg-open / Windows start（以及 explorer 的 URL 形式不处理） */
const OPENER_PATTERN = /^(?:open|xdg-open|start)(?:\.exe)?\s+([\s\S]+)$/i

/** 带值的开关（macOS：-a 应用名、-b bundle id、-e/-t 文本编辑） */
const FLAG_WITH_VALUE = /^-(?:a|b|e|t)\s+(?:"[^"]*"|'[^']*'|\S+)\s*/i

/** 无值开关（-n/-g/-R/-W/-F 等） */
const FLAG_BOOLEAN = /^-[a-zA-Z]+\s*/i

/** 回环地址上的 http 服务 */
const LOOPBACK_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]\S*)?$/i

/** 本地页面文件扩展名 */
const LOCAL_PAGE_EXT = /\.html?$/i

export interface LocalPageOpenTarget {
    /** 本地页面文件绝对路径 */
    filePath?: string
    /** 回环地址上的服务地址 */
    url?: string
    /** 命中时用于向模型解释的原始目标 */
    rawTarget: string
}

/** 去掉命令首尾的引号 */
function unquote(value: string): string {
    const trimmed = value.trim()
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1)
    }
    return trimmed
}

/**
 * 剥离打开工具的参数，取出真正的目标
 *
 * `start` 在 Windows 上允许把窗口标题放在目标之前（`start "" page.html`），
 * 空标题一并剥掉。
 */
function extractTarget(rest: string): string {
    let token = rest.trim()

    // 复合命令（管道 / 连接符 / 重定向）不在这里处理：交给原命令链路
    if (/[|;&<>]/.test(token)) return ''

    while (token) {
        const flagWithValue = token.match(FLAG_WITH_VALUE)
        if (flagWithValue) {
            token = token.slice(flagWithValue[0].length).trim()
            continue
        }
        const flag = token.match(FLAG_BOOLEAN)
        if (flag && !/^-\d/.test(token)) {
            token = token.slice(flag[0].length).trim()
            continue
        }
        break
    }

    // Windows 的空标题占位：start "" page.html
    const emptyTitle = token.match(/^(?:""|'')\s+/)
    if (emptyTitle) token = token.slice(emptyTitle[0].length).trim()

    return unquote(token)
}

/**
 * 识别「用系统浏览器打开本地页面」的命令
 *
 * @param command 完整命令字符串
 * @param baseDir 相对路径的解析基准目录（命令的工作目录）
 */
export function detectLocalPageOpenCommand(
    command: string,
    baseDir: string | null | undefined,
): LocalPageOpenTarget | null {
    if (typeof command !== 'string') return null

    const trimmed = command.trim()
    const matched = trimmed.match(OPENER_PATTERN)
    if (!matched) return null

    const target = extractTarget(matched[1])
    if (!target) return null

    if (LOOPBACK_URL.test(target)) {
        return { url: target, rawTarget: target }
    }

    let filePath = target
    if (/^file:\/\//i.test(filePath)) {
        try {
            filePath = decodeURIComponent(new URL(filePath).pathname)
        } catch {
            return null
        }
    }

    // 只处理页面文件：目录 / 文档 / 其他类型保持原行为
    if (!LOCAL_PAGE_EXT.test(filePath.split(/[?#]/)[0])) return null

    const cleaned = filePath.split(/[?#]/)[0]
    const absolute = resolveToAbsolute(cleaned, baseDir || null)
    // 无基准目录时相对路径落不了地，交给原命令链路处理
    if (!absolute.startsWith('/') && !/^[a-zA-Z]:/.test(absolute)) return null

    return { filePath: absolute, rawTarget: target }
}
