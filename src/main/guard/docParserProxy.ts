/**
 * 文档解析代理 — 主进程侧薄封装（utilityProcess 隔离 + 内联回退）
 *
 * 职责：
 * - 将解析任务派发给 docparser.worker 子进程执行（默认路径）
 * - 子进程不可用 / 崩溃 / 超时自动回退到主进程内联解析（docParserCore），行为一致
 * - 子进程空闲 5 分钟自动退出，下次任务重新 fork（顺带释放解析库常驻内存）
 * - 崩溃自动重启（最多 3 次，指数退避），超限后本次直接走内联回退
 *
 * 安全边界：调用方（IPC handler）仍负责路径校验与安全日志，本模块只管计算。
 */

import { utilityProcess } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import * as path from 'path'
import {
  DocParserKind,
  DocParserRequest,
  DocParserResponse,
  PdfPageImage,
  RenderPdfPagesOptions,
  runDocParserTask,
} from './docParserCore'

/** 单任务超时（大 Excel/PDF 解析可能较慢，给足余量） */
const TASK_TIMEOUT_MS = 120_000

/** 子进程空闲自动退出阈值 */
const IDLE_EXIT_MS = 5 * 60_000

/** 崩溃重启上限（指数退避），超过后保持内联回退模式 */
const MAX_RESTARTS = 3

interface PendingTask {
  req: DocParserRequest
  resolve: (res: DocParserResponse) => void
  timer: NodeJS.Timeout
}

class DocParserProxyImpl {
  private child: Electron.UtilityProcess | null = null
  private pending = new Map<number, PendingTask>()
  private nextId = 1
  private idleTimer: NodeJS.Timeout | null = null
  private restarts = 0
  private spawnFailed = false

  /** 派发解析任务：优先子进程，失败回退主进程内联 */
  async run(
    kind: DocParserKind,
    filePath: string,
    sheetData?: any,
    renderOptions?: RenderPdfPagesOptions,
  ): Promise<DocParserResponse> {
    const req: DocParserRequest = { id: this.nextId++, kind, filePath, sheetData, renderOptions }
    const child = this.ensureChild()
    if (!child) {
      return runDocParserTask(req)
    }
    return new Promise<DocParserResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id)
        logger.system.warn(`[DocParserProxy] task ${req.id} (${kind}) timeout, fallback to inline`)
        runDocParserTask(req).then(resolve)
      }, TASK_TIMEOUT_MS)
      this.pending.set(req.id, { req, resolve, timer })
      child.postMessage(req)
    })
  }

  /** 便捷方法：解析文本，失败返回 null（与旧提取器接口对齐） */
  async extractText(kind: DocParserKind, filePath: string): Promise<string | null> {
    const res = await this.run(kind, filePath)
    return res.ok ? (res.text ?? null) : null
  }

  /** 便捷方法：把 PDF 渲染为页面图，供本地 OCR 使用；失败返回空数组 */
  async renderPdfPages(
    filePath: string,
    options?: RenderPdfPagesOptions,
  ): Promise<PdfPageImage[]> {
    const res = await this.run('pdfPages', filePath, undefined, options)
    return res.ok ? (res.pageImages ?? []) : []
  }


  /** 确保 worker 存活；不可用时返回 null（走内联回退） */
  private ensureChild(): Electron.UtilityProcess | null {
    if (this.spawnFailed) return null
    if (this.child) return this.child

    try {
      const workerPath = path.join(__dirname, 'docparser.worker.js')
      this.child = utilityProcess.fork(workerPath, [], { stdio: 'pipe' })

      this.child.on('message', (res: DocParserResponse) => {
        const task = this.pending.get(res.id)
        if (task) {
          this.pending.delete(res.id)
          clearTimeout(task.timer)
          task.resolve(res)
        }
        this.scheduleIdleExit()
      })

      this.child.on('exit', (code) => {
        this.rejectAllPending(`worker exited (code=${code})`)
        this.child = null
        // 非空闲主动退出的崩溃场景：指数退避重启，超限后放弃子进程模式
        if (this.pending.size === 0 && code === 0) {
          this.restarts = 0
          return
        }
        if (this.restarts < MAX_RESTARTS) {
          this.restarts++
          const delay = Math.min(1000 * 2 ** (this.restarts - 1), 8000)
          logger.system.warn(`[DocParserProxy] worker crashed (code=${code}), restart #${this.restarts} in ${delay}ms`)
          setTimeout(() => { this.ensureChild() }, delay)
        } else {
          logger.system.warn('[DocParserProxy] worker restart limit reached, stay in inline fallback mode')
          this.spawnFailed = true
        }
      })

      this.restarts = 0
      return this.child
    } catch (err) {
      logger.system.warn('[DocParserProxy] fork failed, fallback to inline:', err)
      this.spawnFailed = true
      return null
    }
  }

  /** 空闲一段时间后主动结束子进程，释放解析库内存 */
  private scheduleIdleExit(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.child && this.pending.size === 0) {
        this.child.kill()
        this.child = null
      }
    }, IDLE_EXIT_MS)
    // idleTimer 不阻止进程退出
    this.idleTimer.unref?.()
  }

  /** 子进程异常退出时，将等待中的任务转为主进程内联执行 */
  private rejectAllPending(reason: string): void {
    if (this.pending.size === 0) return
    logger.system.warn(`[DocParserProxy] ${reason}, re-running ${this.pending.size} pending task(s) inline`)
    for (const [id, task] of this.pending) {
      this.pending.delete(id)
      clearTimeout(task.timer)
      runDocParserTask(task.req).then(task.resolve)
    }
  }

  /** 应用退出前清理子进程 */
  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (this.child) {
      this.child.kill()
      this.child = null
    }
    this.pending.clear()
  }
}

export const docParserProxy = new DocParserProxyImpl()
