/**
 * 「用系统浏览器打开页面」命令识别
 *
 * 为什么需要：让用户看到刚生成的页面这一步，模型很容易沿用外部习惯——
 * `open index.html`（macOS）/ `start index.html`（Windows）/ `xdg-open`（Linux）。
 * 这类命令把预览留在应用之外，而且在嵌入了自动化栈的环境里常常直接失败
 * （file: 协议被拦截），失败后模型往往再起一个 `python3 -m http.server` 兜底，
 * 于是终端里多出一个需要用户手动停掉的常驻进程。
 *
 * 本模块做两件事，命中后由执行层处理（见 toolExecutors.run_command）：
 * 1. detectLocalPageOpenCommand —— 识别「打开器 + 页面目标」的组合，
 *    就地改走内置浏览器预览。目标判定覆盖三类：
 *    - 本地页面文件（.html / .htm 且真实存在）
 *    - file:// 形式的本地页面
 *    - 任意 http/https 地址（内置浏览器同样能渲染，优先走内置，
 *      避免「内置已开、外部又开一份」的重复展示）
 * 2. hasSystemBrowserOpenCommand —— 识别命令中「确实会拉起系统浏览器」的打开器：
 *    打开器（open / start / xdg-open）的目标是网页地址或本地页面文件，以及
 *    vite/webpack 的 --open 开关。这类命令无法安全改写（可能连带启动服务），
 *    由执行层在成功执行后同步关闭内置预览标签页，维持「内置 / 外部只开一个」
 *    的互斥。
 *
 *    注意：打开器只是「打开了浏览器」的充分条件，不是必要条件——`open .` /
 *    `open -a Cursor file.ts` 这类目标是目录或非页面文件，系统会交给 Finder /
 *    编辑器而不是浏览器，因此不能算作「拉起了浏览器」（否则会误关内置预览）。
 *
 * 目录、文档、应用等目标一律不拦截。
 */

import { resolveToAbsolute } from '@shared/toolkit/pathHelper'

/** 打开工具：macOS open / Linux xdg-open / Windows start（以及 explorer 的 URL 形式不处理） */
const OPENER_PATTERN = /^(?:cmd(?:\.exe)?\s+\/c\s+)?(?:open|xdg-open|start)(?:\.exe)?\s+([\s\S]+)$/i

/**
 * 复合命令分段：&& / || / ; / 换行 / 管道，以及「后台 & 后紧跟打开命令」的情况。
 *
 * 末尾的 lookahead 只在 & 之后是打开命令时才切分，避免把含查询参数的
 * 未加引号 URL（`open https://x.com?a=1&b=2`）拆碎。
 */
const SEGMENT_SPLIT = /&&|\|\||;|\n|\s*\|\s*|\s*&\s*(?=(?:cmd(?:\.exe)?\s+\/c\s+)?(?:open|xdg-open|start)(?:\.exe)?\s)/i

/** dev server 的自动开页开关：vite --open / webpack-dev-server --open 等 */
const DEV_SERVER_OPEN_FLAG = /\s--open\b/i

/** 带值的开关（macOS：-a 应用名、-b bundle id、-e/-t 文本编辑） */
const FLAG_WITH_VALUE = /^-(?:a|b|e|t)\s+(?:"[^"]*"|'[^']*'|\S+)\s*/i

/** 无值开关（-n/-g/-R/-W/-F 等） */
const FLAG_BOOLEAN = /^-[a-zA-Z]+\s*/i

/** 回环地址上的 http 服务 */
const LOOPBACK_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]\S*)?$/i

/** 任意 http/https 地址（非回环的外网页面同样交给内置浏览器，保持浏览器互斥） */
const HTTP_URL = /^https?:\/\/\S+$/i

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

    if (LOOPBACK_URL.test(target) || HTTP_URL.test(target)) {
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

/**
 * 识别命令中是否包含会拉起系统浏览器的打开器
 *
 * 打开器是否真的拉起浏览器，取决于它的目标：
 * - 目标是网页地址（http/https）或本地页面文件（.html/.htm）→ 系统浏览器接管
 * - 目标是目录、应用（-a bird）、文档等 → 交给 Finder / 编辑器 / 预览，不拉起浏览器
 * 因此这里像 detectLocalPageOpenCommand 一样解析出真实目标再判定，而不是见到
 * `open` 就认定「浏览器被拉起」——否则 `open .` / `open -a Cursor file.ts` 之类
 * 的日常命令会误关内置预览标签页。
 *
 * 另外覆盖 dev server 的 --open 开关（vite --open、npm run dev -- --open 等）：
 * 这类命令会自行拉起浏览器，同样构成互斥。
 */
export function hasSystemBrowserOpenCommand(command: string): boolean {
    if (typeof command !== 'string') return false

    const segments = command.split(SEGMENT_SPLIT)
    const opensBrowserPage = segments.some((raw) => {
        const matched = raw.trim().match(OPENER_PATTERN)
        if (!matched) return false

        const target = extractTarget(matched[1])
        if (!target) return false

        // 打开网页地址：系统浏览器接管
        if (HTTP_URL.test(target)) return true
        // 打开本地页面文件：系统浏览器接管（file:// 已在上游识别，这里按扩展名兜底）
        return LOCAL_PAGE_EXT.test(target.split(/[?#]/)[0])
    })
    if (opensBrowserPage) return true

    return DEV_SERVER_OPEN_FLAG.test(command)
}
