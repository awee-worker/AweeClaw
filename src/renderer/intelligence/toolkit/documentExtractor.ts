/**
 * 文档提取器 — 从多种文档格式中提取文本内容
 *
 * 提取策略（按优先级）：
 *   1. 本地提取（extractDocumentLocal）— 调用 main 进程原生库
 *   2. 后端流式提取（extractDocumentViaBackendStream）— SSE 分块接收，支持进度
 *   3. 后端非流式提取（extractDocumentViaBackend）— multipart 上传，兜底
 *
 * 支持格式：PDF / DOCX / DOC / XLSX / XLS / CSV / PPTX / PPT / TXT / MD
 *
 * 从 toolExecutors.ts 拆分而来，保持原始业务逻辑不变。
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import type { ToolExecutionResult } from '@intelligence/providerTypes'
import { getAccessToken, getServerUrl } from '@services/backendApi'

// ─── 类型定义 ──────────────────────────────────────────────

/** 文档提取结果构建选项 */
export interface ExtractResultOptions {
    sheetNames?: string[]
    ocrUsed?: boolean
    source?: 'local' | 'backend'
}

// ─── 核心函数 ──────────────────────────────────────────────

/**
 * 构建提取结果（统一格式化输出）
 * - 大文件截断保护（100KB）
 * - 输出带元信息的轻量 Markdown
 */
export function buildExtractResult(
    ext: string,
    rawText: string,
    startTime: number,
    options: ExtractResultOptions = {},
): ToolExecutionResult {
    const MAX_LEN = 100 * 1024
    const truncated = rawText.length > MAX_LEN
    const content = truncated
        ? rawText.slice(0, MAX_LEN) + `\n\n...（内容较长，共 ${rawText.length} 字符，已显示前 ${MAX_LEN} 字符）`
        : rawText

    const durationMs = Date.now() - startTime
    const source = options.source || 'local'

    const meta = [
        `格式: ${ext}`,
        `字符数: ${rawText.length}${truncated ? ` (仅显示前 ${MAX_LEN} 字符)` : ''}`,
        options.sheetNames && options.sheetNames.length > 0 ? `工作表: ${options.sheetNames.join(', ')}` : '',
        `OCR: ${options.ocrUsed ? '是' : '否'}`,
        `来源: ${source === 'backend' ? '后端兜底' : '本地'}`,
        `耗时: ${durationMs}ms`,
    ].filter(Boolean).join(' | ')

    const result = `> 📄 文档提取: ${meta}\n\n${content}`

    logger.agent.info(`[extract_document] Success: format=${ext}, chars=${rawText.length}, source=${source}, duration=${durationMs}ms`)

    return { success: true, result }
}

/**
 * 本地提取（IPC 调用 main 进程原生库）
 * 调用 api.file.extractXxxText 系列函数，对应格式自动分发
 */
export async function extractDocumentLocal(
    filePath: string,
    ext: string,
    startTime: number,
): Promise<ToolExecutionResult> {
    try {
        let rawText: string | null = null
        let sheetNames: string[] | undefined

        switch (ext) {
            case 'pdf':
                rawText = await api.file.extractPdfText(filePath)
                break
            case 'docx':
                rawText = await api.file.extractDocxText(filePath)
                break
            case 'doc':
                rawText = await api.file.extractDocText(filePath)
                break
            case 'xlsx':
            case 'xls':
            case 'csv':
                rawText = await api.file.extractXlsxText(filePath)
                sheetNames = rawText?.match(/## Sheet: (.+)/g)?.map(m => m.replace('## Sheet: ', '')) || []
                break
            case 'ppt':
            case 'pptx':
                rawText = await api.file.extractPptText(filePath)
                break
            case 'txt':
            case 'md':
                rawText = await api.file.read(filePath)
                break
        }

        if (!rawText || rawText.trim().length === 0) {
            const durationMs = Date.now() - startTime
            return {
                success: false,
                result: '',
                error: `本地文本提取为空（耗时 ${durationMs}ms）。该文档可能是扫描版/图片型，需要 OCR 或后端兜底。`,
            }
        }

        return buildExtractResult(ext, rawText, startTime, { sheetNames, source: 'local' })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.agent.warn(`[extract_document] Local failed: ${filePath}, error: ${message}`)
        return {
            success: false,
            result: '',
            error: `本地提取失败: ${message}`,
        }
    }
}

/**
 * 后端兜底提取（multipart/form-data 上传文件到 /api/v1/document-extract）
 * 当本地提取失败或返回空内容时触发，复用后端的提取能力（含未来 OCR 扩展）
 */
export async function extractDocumentViaBackend(
    filePath: string,
    ext: string,
    startTime: number,
): Promise<ToolExecutionResult> {
    const serverUrl = getServerUrl()
    const accessToken = getAccessToken()

    if (!serverUrl) {
        logger.agent.warn(`[extract_document] Backend fallback skipped: server URL not configured`)
        return { success: false, result: '', error: '后端服务未配置，无法兜底' }
    }

    try {
        // 1. 读取文件二进制数据（readBinary 返回 base64 字符串）
        const base64Data = await api.file.readBinary(filePath)
        if (!base64Data) {
            return { success: false, result: '', error: `无法读取文件: ${filePath}` }
        }
        const filename = filePath.split(/[\\/]/).pop() || `document.${ext}`

        // 2. base64 解码为 Uint8Array，构建 FormData 上传
        const binaryString = atob(base64Data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
        }
        const formData = new FormData()
        const blob = new Blob([bytes])
        formData.append('file', blob, filename)

        // 3. 调用后端接口
        const response = await fetch(`${serverUrl}/api/v1/document-extract`, {
            method: 'POST',
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            body: formData,
        })

        if (!response.ok) {
            const errText = await response.text().catch(() => '')
            logger.agent.warn(`[extract_document] Backend HTTP ${response.status}: ${errText}`)
            return { success: false, result: '', error: `后端提取失败 (HTTP ${response.status})` }
        }

        const json = await response.json() as {
            success: boolean
            data?: {
                format: string
                content: string
                meta: {
                    charCount: number
                    sheetNames?: string[]
                    ocrUsed: boolean
                    durationMs: number
                    truncated: boolean
                }
                error?: string
            }
        }

        if (!json.success || !json.data?.content) {
            return {
                success: false,
                result: '',
                error: json.data?.error || '后端提取返回空内容，可能为扫描版需 OCR',
            }
        }

        return buildExtractResult(ext, json.data.content, startTime, {
            sheetNames: json.data.meta.sheetNames,
            ocrUsed: json.data.meta.ocrUsed,
            source: 'backend',
        })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.agent.warn(`[extract_document] Backend fallback failed: ${filePath}, error: ${message}`)
        return { success: false, result: '', error: `后端兜底失败: ${message}` }
    }
}

/**
 * 后端流式兜底提取（SSE，分块接收内容）
 *
 * 调用后端 POST /api/v1/document-extract/stream：
 * - 服务端推送 progress 事件（cache_check / extracting / ocr_start / ocr_progress）
 * - 内容分块通过 content 事件推送（每块 8KB），客户端按 index 顺序拼接
 * - 最终 done 事件携带元信息（format / meta / error）
 *
 * 适用场景：大文件提取、扫描版 PDF OCR 等耗时操作，避免 HTTP 长连接超时，
 * 同时支持流式注入 AI 上下文（边接收边显示进度）。
 *
 * 失败回退：若 SSE 建立失败，自动回退到非流式 extractDocumentViaBackend。
 */
export async function extractDocumentViaBackendStream(
    filePath: string,
    ext: string,
    startTime: number,
): Promise<ToolExecutionResult> {
    const serverUrl = getServerUrl()
    const accessToken = getAccessToken()

    if (!serverUrl) {
        return extractDocumentViaBackend(filePath, ext, startTime)
    }

    try {
        const base64Data = await api.file.readBinary(filePath)
        if (!base64Data) {
            return { success: false, result: '', error: `无法读取文件: ${filePath}` }
        }
        const filename = filePath.split(/[\\/]/).pop() || `document.${ext}`

        const binaryString = atob(base64Data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
        }
        const formData = new FormData()
        const blob = new Blob([bytes])
        formData.append('file', blob, filename)

        const response = await fetch(`${serverUrl}/api/v1/document-extract/stream`, {
            method: 'POST',
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            body: formData,
        })

        if (!response.ok || !response.body) {
            logger.agent.warn(`[extract_document] Stream HTTP ${response.status}, fallback to non-stream`)
            return extractDocumentViaBackend(filePath, ext, startTime)
        }

        // ── SSE 解析 ──
        const reader = response.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buffer = ''

        /** 按序号缓存的内容块 */
        const chunks = new Map<number, string>()
        let totalChunks = 0
        let doneMeta: {
            success: boolean
            format?: string
            meta?: { sheetNames?: string[]; ocrUsed?: boolean; charCount?: number; durationMs?: number }
            error?: string
        } | null = null

        /** 解析 SSE 事件块 */
        const parseSseEvents = (raw: string): Array<{ event: string; data: string }> => {
            const events: Array<{ event: string; data: string }> = []
            const blocks = raw.split('\n\n')
            for (const block of blocks) {
                if (!block.trim()) continue
                let event = 'message'
                let data = ''
                for (const line of block.split('\n')) {
                    if (line.startsWith('event: ')) event = line.slice(7).trim()
                    else if (line.startsWith('data: ')) data += line.slice(6)
                }
                events.push({ event, data })
            }
            return events
        }

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            // 按空行切分事件
            const lastDoubleNewline = buffer.lastIndexOf('\n\n')
            if (lastDoubleNewline === -1) continue

            const rawEvents = buffer.slice(0, lastDoubleNewline + 2)
            buffer = buffer.slice(lastDoubleNewline + 2)

            for (const { event, data } of parseSseEvents(rawEvents)) {
                try {
                    const payload = JSON.parse(data)
                    if (event === 'progress') {
                        logger.agent.info(
                            `[extract_document] Stream progress: ${payload.stage} ${payload.percent}% - ${payload.message}`,
                        )
                    } else if (event === 'content') {
                        chunks.set(payload.index, payload.chunk)
                        totalChunks = Math.max(totalChunks, payload.total)
                    } else if (event === 'done') {
                        doneMeta = payload
                    } else if (event === 'error') {
                        logger.agent.warn(`[extract_document] Stream error event: ${payload.message}`)
                        return { success: false, result: '', error: `后端流式提取失败: ${payload.message}` }
                    }
                } catch (err) {
                    logger.agent.warn(`[extract_document] SSE parse error: ${err instanceof Error ? err.message : err}`)
                }
            }
        }

        if (!doneMeta || !doneMeta.success) {
            return {
                success: false,
                result: '',
                error: doneMeta?.error || '后端流式提取返回失败',
            }
        }

        // 按 index 顺序拼接内容
        let content = ''
        for (let i = 0; i < totalChunks; i++) {
            content += chunks.get(i) || ''
        }

        if (!content) {
            return { success: false, result: '', error: '后端流式提取返回空内容' }
        }

        return buildExtractResult(ext, content, startTime, {
            sheetNames: doneMeta.meta?.sheetNames,
            ocrUsed: doneMeta.meta?.ocrUsed,
            source: 'backend',
        })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.agent.warn(`[extract_document] Stream failed, fallback: ${message}`)
        return extractDocumentViaBackend(filePath, ext, startTime)
    }
}
