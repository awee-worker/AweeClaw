/**
 * 文档解析 utilityProcess 入口 — 重计算任务在子进程执行
 *
 * 职责：
 * - 接收主进程的解析请求（pdf/docx/doc/xlsx/ppt/saveXlsx）
 * - 在子进程中调用 docParserCore 完成解析，回传结果
 * - 大 Excel / PDF 解析不再阻塞主进程事件循环
 *
 * 说明：utilityProcess 的 MessagePortMain 需要 node: 前缀 require；
 * 本文件作为 CJS 单独入口构建（docparser.worker.js），不进主 bundle。
 */

import { runDocParserTask, DocParserRequest, DocParserResponse } from './docParserCore'

if (!process.parentPort) {
  throw new Error('This file must be run as a utility process.')
}

process.parentPort.on('message', (e: Electron.MessageEvent) => {
  const req = e.data as DocParserRequest
  runDocParserTask(req)
    .then((res: DocParserResponse) => {
      process.parentPort!.postMessage(res)
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      const res: DocParserResponse = { id: req.id, ok: false, error: message }
      process.parentPort!.postMessage(res)
    })
})
