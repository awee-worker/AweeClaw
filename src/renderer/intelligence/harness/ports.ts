/**
 * Harness Core 端口桥接
 *
 * 将客户端本地的日志引擎（@toolkit/LogEngine）与审计通道（Electron IPC）
 * 适配为 @aweeclaw/harness-core 所需的 LoggerPort / AuditSink 端口。
 *
 * 通过 setLogger / setAuditSink 注入到共享包后，
 * 共享包内的中间件（Logging/Audit/ErrorBoundary/CircuitBreaker/Retry）
 * 即可使用客户端的日志与审计通道，无需修改共享包代码。
 */

import { logger } from '@toolkit/LogEngine'
import type { LoggerPort, AuditSink, AuditSinkEntry } from '@aweeclaw/harness-core'

/**
 * 客户端日志桥接
 *
 * 将 harness-core 的 LoggerPort 调用转发到 @toolkit/LogEngine 的 agent 分类。
 */
export class ClientLoggerBridge implements LoggerPort {
  debug(message: string, context?: Record<string, unknown>): void {
    logger.agent.debug(message, context ?? '')
  }

  info(message: string, context?: Record<string, unknown>): void {
    logger.agent.info(message, context ?? '')
  }

  warn(message: string, context?: Record<string, unknown>): void {
    logger.agent.warn(message, context ?? '')
  }

  error(message: string, context?: Record<string, unknown>): void {
    logger.agent.error(message, context ?? '')
  }
}

/**
 * 客户端审计持久化桥接
 *
 * 将 harness-core 的 AuditSinkEntry 通过 Electron IPC（window.electronAPI.auditAppend）
 * 持久化到主进程，失败时静默丢弃以保证主流程不中断。
 */
export class ClientAuditSinkBridge implements AuditSink {
  async append(entries: AuditSinkEntry | AuditSinkEntry[]): Promise<void> {
    const list = Array.isArray(entries) ? entries : [entries]
    if (list.length === 0) return

    try {
      const win = window as unknown as Record<string, unknown>
      const eapi = win.electronAPI as Record<string, unknown> | undefined
      if (eapi && typeof eapi.auditAppend === 'function') {
        await (eapi.auditAppend as (entries: AuditSinkEntry[]) => Promise<void>)(list)
      }
    } catch {
      // 持久化失败不影响主流程，harness-core 会在内存中保留审计记录
    }
  }
}
