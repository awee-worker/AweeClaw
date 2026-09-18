/**
 * 终端命令错误观察者
 *
 * 监听终端输出，检测典型错误关键字（npm ERR!、Error:、Failed to build 等）。
 *
 * 职责：AI 流程推进 — 如果该终端有正在执行的 agent 命令，主动结束命令执行，
 *       将已捕获的错误输出返回给 AI，避免 AI 一直停留在"命令执行中"状态。
 *
 * 设计要点：
 * - 数据块只入队，按固定节拍合并分析（见 ANALYZE_INTERVAL_MS），成本与输出速率解耦
 * - 错误检测后延迟一段短时间再 finalize，让命令输出更多错误详情
 * - 不再弹出 toast 通知：错误详情已在工具调用卡片中展示，避免重复打扰用户
 * - 仅结束 agent 发起的命令（hasActiveAgentCommand），不影响用户手动输入
 */
import { terminalManager } from '@services/TerminalAdapter'
import { logger } from '@toolkit/LogEngine'

/** 错误关键字检测后，等待此时间再 finalize，让命令输出更多错误详情 */
const ERROR_FINALIZE_DELAY_MS = 3000

/**
 * 分析节拍（毫秒）
 *
 * 数据块只入队，每个节拍合并分析一次，因此分析成本与「时间」相关而不是与「输出速率」相关。
 *
 * 之所以不用 debounce（原先的实现就是逐块 clearTimeout + setTimeout）：
 * 终端持续刷屏时 debounce 会被无限推迟，错误关键字必须等到输出完全停止才可能被分析到；
 * 而「等待输出稳定」这件事对关键字匹配本来也没有意义。
 */
const ANALYZE_INTERVAL_MS = 1000
/** 保留用于错误回溯的尾部文本上限 */
const TAIL_RETAIN_CHARS = 5000
/** 待分析分片积压上限：超过则立即分析，避免长任务把节拍一直推迟 */
const MAX_PENDING_CHARS = 64 * 1024

/** 典型错误关键字（模块级复用，避免每次分析重新构造正则） */
const ERROR_PATTERN = /(npm ERR!|Error:|failed to compile|Failed to build|SyntaxError|UnhandledPromiseRejection|Traceback \(most recent call last\))/i

class TerminalWatcher {
    /** 保留的尾部文本：供跨节拍的关键字回溯 */
    private buffers: Map<string, string> = new Map()
    /** 待分析分片：避免每一块数据都重建整个缓冲区字符串 */
    private pendingChunks: Map<string, string[]> = new Map()
    private pendingChars: Map<string, number> = new Map()
    private analyzeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
    /** 已为某个终端安排了错误 finalize 的定时器，避免重复安排 */
    private pendingFinalizeTimers: Map<string, NodeJS.Timeout> = new Map()
    private unsubscribe: (() => void) | null = null

    start() {
        if (this.unsubscribe) return

        this.unsubscribe = terminalManager.onData((id, data) => {
            this.handleData(id, data)
        })
    }

    stop() {
        if (this.unsubscribe) {
            this.unsubscribe()
            this.unsubscribe = null
        }

        for (const timer of this.analyzeTimers.values()) {
            clearTimeout(timer)
        }
        for (const timer of this.pendingFinalizeTimers.values()) {
            clearTimeout(timer)
        }
        this.analyzeTimers.clear()
        this.pendingFinalizeTimers.clear()
        this.pendingChunks.clear()
        this.pendingChars.clear()
        this.buffers.clear()
    }

    private handleData(id: string, data: string) {
        if (!data) return

        const chunks = this.pendingChunks.get(id)
        if (chunks) {
            chunks.push(data)
        } else {
            this.pendingChunks.set(id, [data])
        }

        const pending = (this.pendingChars.get(id) || 0) + data.length
        this.pendingChars.set(id, pending)

        // 积压过多说明节拍被长任务推迟了，立即分析，避免错误关键字一直压在队列里
        if (pending >= MAX_PENDING_CHARS) {
            this.flushBuffer(id)
            return
        }

        // 固定节拍：已有待执行分析时不重置定时器
        if (!this.analyzeTimers.has(id)) {
            this.analyzeTimers.set(id, setTimeout(() => {
                this.flushBuffer(id)
            }, ANALYZE_INTERVAL_MS))
        }
    }

    /** 分析节拍点：合并分片 → 追加到保留尾部 → 分析 */
    private flushBuffer(id: string) {
        const timer = this.analyzeTimers.get(id)
        if (timer) {
            clearTimeout(timer)
            this.analyzeTimers.delete(id)
        }

        const chunks = this.pendingChunks.get(id)
        this.pendingChunks.delete(id)
        this.pendingChars.delete(id)
        if (!chunks || chunks.length === 0) return

        const merged = chunks.join('')
        const tail = (this.buffers.get(id) || '') + merged
        this.buffers.set(id, tail.length > TAIL_RETAIN_CHARS ? tail.slice(-TAIL_RETAIN_CHARS) : tail)

        this.analyzeBuffer(id)
    }

    private analyzeBuffer(id: string) {
        const buffer = this.buffers.get(id) || ''
        // 移除 ANSI 转义符号以便正则匹配
        const cleanContent = buffer.replace(/\u001b\[[0-9;]*m/g, '')

        // 检测典型的错误关键字
        if (ERROR_PATTERN.test(cleanContent)) {
            // 主动结束正在执行的 agent 命令，把错误返回给 AI
            // 不再弹 toast：错误详情已在工具调用卡片中展示，避免重复打扰用户
            this.scheduleErrorFinalize(id)
        }
    }

    /**
     * 安排错误 finalize：延迟一段时间后结束活动命令
     *
     * 延迟设计（3 秒）：
     * - 让命令继续输出更多错误详情（如 npm ERR! 后面通常还有完整的错误堆栈）
     * - 如果命令在此期间自然结束（sentinel 触发），finalize 会被忽略（settled=true）
     * - 避免在错误关键字刚出现时就截断输出
     *
     * 幂等保护：同一终端已有待执行的 finalize 定时器时不重复安排
     */
    private scheduleErrorFinalize(terminalId: string) {
        // 幂等：已有待执行的 finalize，不重复安排
        if (this.pendingFinalizeTimers.has(terminalId)) return

        // 仅当该终端有正在执行的 agent 命令时才需要主动结束
        if (!terminalManager.hasActiveAgentCommand(terminalId)) return

        this.pendingFinalizeTimers.set(terminalId, setTimeout(() => {
            this.pendingFinalizeTimers.delete(terminalId)

            // 再次检查：finalize 期间命令可能已自然结束
            if (!terminalManager.hasActiveAgentCommand(terminalId)) return

            try {
                const finalized = terminalManager.finalizeActiveCommandOnError(terminalId)
                if (finalized) {
                    logger.agent.info(
                        `[TerminalWatcher] Detected command error in terminal ${terminalId}, ` +
                        `actively finalized to return error to AI`,
                    )
                }
            } catch (err) {
                logger.agent.warn(
                    `[TerminalWatcher] Failed to finalize active command on error:`,
                    err,
                )
            }
        }, ERROR_FINALIZE_DELAY_MS))
    }
}

export const terminalWatcher = new TerminalWatcher()
