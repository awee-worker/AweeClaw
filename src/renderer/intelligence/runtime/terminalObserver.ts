/**
 * 终端命令错误观察者
 *
 * 监听终端输出，检测典型错误关键字（npm ERR!、Error:、Failed to build 等）。
 *
 * 职责：AI 流程推进 — 如果该终端有正在执行的 agent 命令，主动结束命令执行，
 *       将已捕获的错误输出返回给 AI，避免 AI 一直停留在"命令执行中"状态。
 *
 * 设计要点：
 * - 错误检测后延迟一段短时间再 finalize，让命令输出更多错误详情
 * - 不再弹出 toast 通知：错误详情已在工具调用卡片中展示，避免重复打扰用户
 * - 仅结束 agent 发起的命令（hasActiveAgentCommand），不影响用户手动输入
 */
import { terminalManager } from '@services/TerminalAdapter'
import { logger } from '@toolkit/LogEngine'

/** 错误关键字检测后，等待此时间再 finalize，让命令输出更多错误详情 */
const ERROR_FINALIZE_DELAY_MS = 3000

class TerminalWatcher {
    private buffers: Map<string, string> = new Map()
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
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

        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer)
        }
        for (const timer of this.pendingFinalizeTimers.values()) {
            clearTimeout(timer)
        }
        this.debounceTimers.clear()
        this.pendingFinalizeTimers.clear()
        this.buffers.clear()
    }

    private handleData(id: string, data: string) {
        if (!this.buffers.has(id)) {
            this.buffers.set(id, '')
        }

        // 累积缓冲区，最大保留 5000 字符
        let buffer = this.buffers.get(id)! + data
        if (buffer.length > 5000) buffer = buffer.slice(-5000)
        this.buffers.set(id, buffer)

        if (this.debounceTimers.has(id)) {
            clearTimeout(this.debounceTimers.get(id)!)
        }

        // debounce 1 秒，等待输出稍微稳定后再分析
        this.debounceTimers.set(id, setTimeout(() => {
            this.analyzeBuffer(id)
        }, 1000))
    }

    private analyzeBuffer(id: string) {
        const buffer = this.buffers.get(id) || ''
        // 移除 ANSI 转义符号以便正则匹配
        const cleanContent = buffer.replace(/\u001b\[[0-9;]*m/g, '')

        // 检测典型的错误关键字
        const errorPattern = /(npm ERR!|Error:|failed to compile|Failed to build|SyntaxError|UnhandledPromiseRejection|Traceback \(most recent call last\))/i

        if (errorPattern.test(cleanContent)) {
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
