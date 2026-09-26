/**
 * HTTP 传输桥接 — 网络请求的 IPC 处理器
 *
 * 职责：
 * - 暴露 URL 内容读取、Web 搜索等 IPC 接口
 * - 为渲染进程提供受限的网络请求能力（避免直接暴露 fetch）
 */

import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../core/ipcGuard'
import { AWEECLAW_SEARXNG_BASE_URL, AWEECLAW_SEARXNG_API_KEY } from '@shared/configuration/searchProviders'
import { smartSearchDispatcher } from './verticalSearch/smartSearchDispatcher'
import type { SearchDomain } from './verticalSearch/domainClassifier'
import { extractRelevantContent } from './verticalSearch/contentExtractor'
import { isRelevantItem } from './verticalSearch/resultRanker'
import { BrowserWindow, dialog } from 'electron'
import * as fs from 'fs'
import * as https from 'https'
import * as http from 'http'
import * as zlib from 'zlib'
import { URL } from 'url'

// ===== 读取 URL 内容 =====

interface ReadUrlResult {
    success: boolean
    content?: string
    title?: string
    error?: string
    contentType?: string
    statusCode?: number
}

/**
 * 直接抓取 URL 内容
 * 支持 gzip/deflate 压缩、流式终止、Buffer 拼接
 */
async function fetchUrlDirect(url: string, timeout = 60000): Promise<ReadUrlResult> {
    return new Promise((resolve) => {
        try {
            const parsedUrl = new URL(url)
            const protocol = parsedUrl.protocol === 'https:' ? https : http

            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
                    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
                    // 启用压缩，减少传输量 5-10 倍
                    'Accept-Encoding': 'gzip, deflate',
                },
                timeout,
            }

            const req = protocol.request(options, (res) => {
                // 处理重定向
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectUrl = res.headers.location.startsWith('http')
                        ? res.headers.location
                        : `${parsedUrl.protocol}//${parsedUrl.host}${res.headers.location}`
                    fetchUrlDirect(redirectUrl, timeout).then(resolve)
                    return
                }

                const contentType = res.headers['content-type'] || ''
                const contentEncoding = res.headers['content-encoding'] || ''

                // 检查是否是文本内容
                if (!contentType.includes('text') &&
                    !contentType.includes('json') &&
                    !contentType.includes('xml') &&
                    !contentType.includes('javascript')) {
                    resolve({
                        success: false,
                        error: `Unsupported content type: ${contentType}`,
                        statusCode: res.statusCode,
                        contentType,
                    })
                    req.destroy()
                    return
                }

                // 根据压缩编码选择解压流
                let responseStream: NodeJS.ReadableStream = res
                if (contentEncoding.includes('gzip')) {
                    responseStream = res.pipe(zlib.createGunzip())
                } else if (contentEncoding.includes('deflate')) {
                    responseStream = res.pipe(zlib.createInflate())
                }

                // 使用 Buffer 拼接（比字符串拼接性能好 3-5 倍）
                const chunks: Buffer[] = []
                let totalLength = 0
                const MAX_SIZE = 500000

                responseStream.on('data', (chunk: Buffer) => {
                    chunks.push(chunk)
                    totalLength += chunk.length
                    // 限制响应大小：达到阈值立即终止连接
                    if (totalLength > MAX_SIZE) {
                        req.destroy()
                        const buffer = Buffer.concat(chunks, MAX_SIZE)
                        const data = buffer.toString('utf8')
                        resolve({
                            success: true,
                            content: processContent(data, contentType),
                            title: extractTitle(data),
                            statusCode: res.statusCode,
                            contentType,
                        })
                    }
                })

                responseStream.on('end', () => {
                    const buffer = Buffer.concat(chunks)
                    const data = buffer.toString('utf8')
                    resolve({
                        success: true,
                        content: processContent(data, contentType),
                        title: extractTitle(data),
                        statusCode: res.statusCode,
                        contentType,
                    })
                })

                responseStream.on('error', () => {
                    resolve({
                        success: false,
                        error: 'Decompression failed',
                        statusCode: res.statusCode,
                        contentType,
                    })
                })
            })

            req.on('error', (error) => {
                resolve({
                    success: false,
                    error: `Request failed: ${error.message}`,
                })
            })

            req.on('timeout', () => {
                req.destroy()
                resolve({
                    success: false,
                    error: 'Request timed out',
                })
            })

            req.end()
        } catch (error) {
            resolve({
                success: false,
                error: `Invalid URL: ${error}`,
            })
        }
    })
}

/**
 * 快速 URL 抓取（专为搜索预取优化）
 *
 * 与 fetchUrlDirect 的区别：
 * - 更短超时：4 秒（vs 60 秒）
 * - 更小下载限制：80KB（vs 500KB）—— 足够提取摘要
 * - 连接超时 3 秒：慢速网站快速失败
 * - 流式终止：达到 80KB 立即断开连接，不等页面下载完
 *
 * 性能对比（典型新闻页面 ~300KB 未压缩）：
 * - 旧方案：下载 500KB → 截断 → 6 秒超时 ≈ 3-6 秒
 * - 新方案：下载 80KB → 压缩后 ~15KB → 流式终止 ≈ 0.5-1.5 秒
 */
async function fetchUrlFast(url: string, timeout = 4000): Promise<ReadUrlResult> {
    return new Promise((resolve) => {
        try {
            const parsedUrl = new URL(url)
            const protocol = parsedUrl.protocol === 'https:' ? https : http

            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
                    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
                    // 关键：启用压缩，300KB 页面压缩后约 30-50KB
                    'Accept-Encoding': 'gzip, deflate',
                },
                // 连接超时：3 秒内未建立连接则失败
                timeout: Math.min(timeout, 3000),
            }

            const req = protocol.request(options, (res) => {
                // 处理重定向（最多 1 次，避免重定向链过长）
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectUrl = res.headers.location.startsWith('http')
                        ? res.headers.location
                        : `${parsedUrl.protocol}//${parsedUrl.host}${res.headers.location}`
                    // 重定向用剩余时间
                    const remainingTime = timeout - 1000
                    if (remainingTime > 500) {
                        fetchUrlFast(redirectUrl, remainingTime).then(resolve)
                    } else {
                        resolve({ success: false, error: 'Redirect timeout' })
                    }
                    return
                }

                // 非 200 响应快速失败
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    resolve({
                        success: false,
                        error: `HTTP ${res.statusCode}`,
                        statusCode: res.statusCode,
                    })
                    req.destroy()
                    return
                }

                const contentType = res.headers['content-type'] || ''
                const contentEncoding = res.headers['content-encoding'] || ''

                // 快速过滤非文本内容
                if (!contentType.includes('text') &&
                    !contentType.includes('json') &&
                    !contentType.includes('xml')) {
                    resolve({
                        success: false,
                        error: `Unsupported content type: ${contentType}`,
                        statusCode: res.statusCode,
                        contentType,
                    })
                    req.destroy()
                    return
                }

                // 解压流
                let responseStream: NodeJS.ReadableStream = res
                if (contentEncoding.includes('gzip')) {
                    responseStream = res.pipe(zlib.createGunzip())
                } else if (contentEncoding.includes('deflate')) {
                    responseStream = res.pipe(zlib.createInflate())
                }

                // 流式收集，达到阈值立即终止
                const chunks: Buffer[] = []
                let totalLength = 0
                const MAX_SIZE = 80000 // 80KB 足够提取摘要

                responseStream.on('data', (chunk: Buffer) => {
                    chunks.push(chunk)
                    totalLength += chunk.length
                    // 关键优化：达到 80KB 立即终止连接
                    if (totalLength >= MAX_SIZE) {
                        req.destroy()
                        const buffer = Buffer.concat(chunks, MAX_SIZE)
                        const data = buffer.toString('utf8')
                        resolve({
                            success: true,
                            content: processContent(data, contentType),
                            title: extractTitle(data),
                            statusCode: res.statusCode,
                            contentType,
                        })
                    }
                })

                responseStream.on('end', () => {
                    const buffer = Buffer.concat(chunks)
                    const data = buffer.toString('utf8')
                    resolve({
                        success: true,
                        content: processContent(data, contentType),
                        title: extractTitle(data),
                        statusCode: res.statusCode,
                        contentType,
                    })
                })

                responseStream.on('error', () => {
                    resolve({
                        success: false,
                        error: 'Decompression failed',
                    })
                })
            })

            req.on('error', (error) => {
                resolve({
                    success: false,
                    error: `Request failed: ${error.message}`,
                })
            })

            req.on('timeout', () => {
                req.destroy()
                resolve({
                    success: false,
                    error: 'Request timed out',
                })
            })

            req.end()
        } catch (error) {
            resolve({
                success: false,
                error: `Invalid URL: ${error}`,
            })
        }
    })
}

/**
 * 提取 HTML 标题
 */
function extractTitle(html: string): string {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    return titleMatch ? titleMatch[1].trim() : ''
}

/**
 * 处理内容：HTML 转纯文本
 */
function processContent(data: string, contentType: string): string {
    if (contentType.includes('html')) {
        return htmlToText(data)
    }
    return data
}

/**
 * 读取 URL 内容
 * 直接本地抓取（支持 gzip 压缩 + 流式终止 + 智能内容提取）
 */
async function fetchUrl(url: string, timeout = 60000): Promise<ReadUrlResult> {
    // 对于非 HTTP(S) URL，直接返回错误
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return {
            success: false,
            error: 'Only HTTP and HTTPS URLs are supported',
        }
    }

    // 对于 JSON/API 端点，直接抓取更合适
    const isApiEndpoint = url.includes('/api/') ||
        url.endsWith('.json') ||
        url.includes('raw.githubusercontent.com') ||
        url.includes('api.github.com')

    if (isApiEndpoint) {
        logger.ipc.debug('[HTTP] API endpoint detected, using direct fetch')
        return fetchUrlDirect(url, timeout)
    }

    // 直接使用本地抓取（已支持 gzip 压缩 + 流式终止 + 智能内容提取）
    // 不再使用 Jina Reader（海外服务国内不可用，会导致 10-30 秒超时）
    logger.ipc.debug('[HTTP] Direct fetch with gzip:', url)
    return fetchUrlDirect(url, timeout)
}

// 简单的 HTML 到文本转换
function htmlToText(html: string): string {
    return html
        // 移除 script 和 style
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        // 移除 HTML 注释
        .replace(/<!--[\s\S]*?-->/g, '')
        // 转换常用标签
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        // 保留链接文本
        .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/gi, '$2 ($1)')
        // 移除所有其他标签
        .replace(/<[^>]+>/g, '')
        // 解码 HTML 实体
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // 清理多余空白
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim()
}

// ===== 网络搜索 =====

interface SearchResult {
    title: string
    url: string
    snippet: string
}

/**
 * 富搜索结果（含元数据 + 预取摘要）
 *
 * 相比基础 SearchResult，额外携带：
 * - publishedDate：发布时间（部分引擎提供）
 * - engine / score：来源引擎与相关性分数
 * - content：预取的网页摘要（并行抓取，限 800 字符），AI 可直接使用，减少 read_url 二次抓取
 */
interface RichSearchResult extends SearchResult {
    publishedDate?: string
    engine?: string
    score?: number
    /** 预取的网页内容摘要（并行抓取，可能为空） */
    content?: string
}

interface WebSearchResult {
    success: boolean
    results?: SearchResult[] | RichSearchResult[]
    error?: string
}

/** 图片搜索结果 */
interface ImageSearchResultItem {
    title: string
    url: string
    /** 图片直链（原图） */
    imgSrc: string
    /** 缩略图链接 */
    thumbnailSrc?: string
    /** 来源引擎 */
    source?: string
    /** 图片尺寸描述 */
    imgSize?: string
}

interface ImageSearchResult {
    success: boolean
    results?: ImageSearchResultItem[]
    error?: string
}

/** 视频搜索结果 */
interface VideoSearchResultItem {
    title: string
    url: string
    /** 缩略图链接 */
    thumbnail?: string
    /** 视频时长（如 "10:30"） */
    length?: string
    /** 作者/频道 */
    author?: string
    /** 来源引擎 */
    source?: string
    /** 发布时间 */
    publishedDate?: string
}

interface VideoSearchResult {
    success: boolean
    results?: VideoSearchResultItem[]
    error?: string
}

interface SearchEngineState {
    searchEngines: Record<string, { enabled: boolean; apiKey?: string; extraValues?: Record<string, string>; customBaseUrl?: string; timeout?: number }>
    activeSearchEngine?: string
    searchTimeout?: number
}

let cachedSearchEngineState: SearchEngineState | null = null

export function setSearchEngineState(state: SearchEngineState) {
    cachedSearchEngineState = state
    logger.ipc.info('[HTTP] Search engine state updated, active:', state.activeSearchEngine || 'none')
}

function getEnabledEngineOrder(): string[] {
    if (!cachedSearchEngineState?.searchEngines) {
        return ['aweeclaw-searxng']
    }
    const engines = cachedSearchEngineState.searchEngines
    const enabled = Object.entries(engines)
        .filter(([, cfg]) => cfg.enabled)
        .map(([id]) => id)

    if (enabled.length === 0) return ['aweeclaw-searxng']

    const active = cachedSearchEngineState.activeSearchEngine
    if (active && enabled.includes(active)) {
        const rest = enabled.filter(id => id !== active)
        return [active, ...rest]
    }

    // 优先级：AweeClaw 官方引擎优先，其次国内可用的免费引擎
    const priority = ['aweeclaw-searxng', 'bing', 'sogou', 'searxng', 'google', 'brave', 'tavily', 'serper', 'jina', 'exa', 'bocha', 'yandex', 'duckduckgo']
    const ordered: string[] = []
    for (const id of priority) {
        if (enabled.includes(id)) ordered.push(id)
    }
    for (const id of enabled) {
        if (!ordered.includes(id)) ordered.push(id)
    }
    return ordered
}

function getEngineConfig(engineId: string): { apiKey?: string; extraValues?: Record<string, string>; customBaseUrl?: string; timeout?: number } {
    const cfg = cachedSearchEngineState?.searchEngines?.[engineId]
    // AweeClaw 官方引擎兜底：即使状态未同步也用内置配置工作
    if (engineId === 'aweeclaw-searxng') {
        return {
            apiKey: cfg?.apiKey || AWEECLAW_SEARXNG_API_KEY,
            extraValues: cfg?.extraValues || { baseUrl: AWEECLAW_SEARXNG_BASE_URL },
            customBaseUrl: cfg?.customBaseUrl,
            timeout: cfg?.timeout,
        }
    }
    return cfg || {}
}
/**
 * 结果相关性准入（统一收口）
 *
 * 各引擎的结果结构一致（title/url/snippet），统一用 isRelevantItem 判定，
 * 避免各引擎实现自行其是、过滤覆盖不一致。
 */
function filterResultsByRelevance(
    results: SearchResult[] | RichSearchResult[],
    query: string,
): SearchResult[] | RichSearchResult[] {
    return results.filter(r => isRelevantItem(r.title, r.snippet || '', query))
}


async function webSearch(query: string, maxResults = 5, timeout?: number, page = 1): Promise<WebSearchResult> {
    const engineOrder = getEnabledEngineOrder()
    // 0 = 不限制超时
    const globalTimeout = timeout !== undefined && timeout !== null
        ? timeout
        : (cachedSearchEngineState?.searchTimeout ?? 30) * 1000
    const perEngineTimeout = globalTimeout > 0
        ? Math.max(Math.floor(globalTimeout / Math.min(engineOrder.length, 3)), 8000)
        : 0

    const errors: string[] = []
    for (const engineId of engineOrder) {
        try {
            const result = await executeSearch(engineId, query, maxResults, perEngineTimeout, page)
            if (result.success && result.results && result.results.length > 0) {
                // 相关性准入：所有引擎的结果都要过这一关
                //
                // 此前只有 SearXNG 系引擎在自己的实现里做了过滤，其余引擎（必应、搜狗、
                // 博查等）的结果直接返回；用户把主引擎切到其中一个，搜索质量就退回未过滤
                // 状态。这里统一收口，过滤后为空则继续尝试下一个引擎。
                const filtered = filterResultsByRelevance(result.results, query)
                if (filtered.length > 0) {
                    logger.ipc.info(`[HTTP] Search succeeded with engine: ${engineId}, results: ${filtered.length}/${result.results.length}`)
                    return { ...result, results: filtered }
                }
                const allFiltered = `all ${result.results.length} results filtered out as irrelevant`
                errors.push(`${engineId}: ${allFiltered}`)
                logger.ipc.warn(`[HTTP] Search engine ${engineId}: ${allFiltered}`)
                continue
            }
            // 失败原因：优先使用 result.error，否则标注"返回 0 条结果"
            const reason = result.error || 'returned 0 results'
            errors.push(`${engineId}: ${reason}`)
            logger.ipc.warn(`[HTTP] Search engine ${engineId} returned no usable results: ${reason}`)
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            errors.push(`${engineId}: ${msg}`)
            logger.ipc.warn(`[HTTP] Search engine ${engineId} failed:`, msg)
        }
    }

    return {
        success: false,
        error: errors.length > 0
            ? `所有搜索引擎均不可用: ${errors.join('; ')}`
            : '没有可用的搜索引擎，请在设置中启用至少一个搜索引擎。',
    }
}

async function executeSearch(engineId: string, query: string, maxResults: number, timeout: number, page = 1): Promise<WebSearchResult> {
    const cfg = getEngineConfig(engineId)
    const engineTimeout = cfg.timeout ? cfg.timeout * 1000 : timeout

    // 仅 SearXNG 系支持 pageno 翻页；其余引擎忽略 page，由上层去重兜底
    switch (engineId) {
        case 'google': return searchWithGoogle(query, cfg.apiKey || '', cfg.extraValues?.cx || '', maxResults, engineTimeout)
        case 'duckduckgo': return searchWithDuckDuckGo(query, maxResults, engineTimeout)
        case 'bing': return searchWithBing(query, maxResults, engineTimeout)
        case 'brave': return searchWithBrave(query, cfg.apiKey || '', maxResults, engineTimeout)
        case 'tavily': return searchWithTavily(query, cfg.apiKey || '', maxResults, engineTimeout)
        case 'serper': return searchWithSerper(query, cfg.apiKey || '', maxResults, engineTimeout)
        case 'jina': return searchWithJina(query, cfg.apiKey || '', maxResults, engineTimeout)
        case 'exa': return searchWithExa(query, cfg.apiKey || '', maxResults, engineTimeout)
        case 'sogou': return searchWithSogou(query, cfg.apiKey || '', maxResults, engineTimeout)
        case 'bocha': return searchWithBocha(query, cfg.apiKey || '', maxResults, engineTimeout)
        case 'aweeclaw-searxng':
        case 'searxng': return searchWithSearXNG(query, cfg.extraValues?.baseUrl || cfg.customBaseUrl || '', maxResults, engineTimeout, cfg.apiKey, page)
        case 'yandex': return searchWithYandex(query, cfg.apiKey || '', maxResults, engineTimeout)
        default: {
            if (cfg.customBaseUrl) return searchWithCustom(engineId, cfg.customBaseUrl, cfg.apiKey, query, maxResults, engineTimeout)
            return { success: false, error: `Unknown search engine: ${engineId}` }
        }
    }
}

function makeJsonRequest(urlStr: string, headers: Record<string, string>, timeout: number): Promise<{ status: number; data: string }> {
    return new Promise((resolve) => {
        const parsed = new URL(urlStr)
        const isHttps = parsed.protocol === 'https:'
        const lib = isHttps ? https : http
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: { 'User-Agent': 'AweeClaw/1.0 (AI Agent Platform)', ...headers },
        }

        const req = lib.request(options, (res) => {
            let data = ''
            res.setEncoding('utf8')
            res.on('data', (chunk: string) => data += chunk)
            res.on('end', () => resolve({ status: res.statusCode || 0, data }))
        })

        req.on('error', (error: Error) => resolve({ status: 0, data: error.message }))
        req.setTimeout(timeout, () => { req.destroy(); resolve({ status: 0, data: 'Request timed out' }) })
        req.end()
    })
}

function makePostRequest(urlStr: string, headers: Record<string, string>, body: string, timeout: number): Promise<{ status: number; data: string }> {
    return new Promise((resolve) => {
        const parsed = new URL(urlStr)
        const isHttps = parsed.protocol === 'https:'
        const lib = isHttps ? https : http
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: { 'User-Agent': 'AweeClaw/1.0 (AI Agent Platform)', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
        }

        const req = lib.request(options, (res) => {
            let data = ''
            res.setEncoding('utf8')
            res.on('data', (chunk: string) => data += chunk)
            res.on('end', () => resolve({ status: res.statusCode || 0, data }))
        })

        req.on('error', (error: Error) => resolve({ status: 0, data: error.message }))
        req.setTimeout(timeout, () => { req.destroy(); resolve({ status: 0, data: 'Request timed out' }) })
        req.write(body)
        req.end()
    })
}

async function searchWithBrave(query: string, apiKey: string, maxResults: number, timeout: number): Promise<WebSearchResult> {
    if (!apiKey) return { success: false, error: 'Brave API Key not configured' }
    try {
        const encoded = encodeURIComponent(query)
        const { status, data } = await makeJsonRequest(
            `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${Math.min(maxResults, 20)}`,
            { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
            timeout,
        )
        if (status !== 200) return { success: false, error: `Brave API returned status ${status}` }
        const json = JSON.parse(data)
        const results: SearchResult[] = []
        if (json.web?.results) {
            for (const item of json.web.results.slice(0, maxResults)) {
                results.push({ title: item.title || '', url: item.url || '', snippet: item.description || '' })
            }
        }
        return { success: true, results }
    } catch (error) {
        return { success: false, error: `Brave search failed: ${error}` }
    }
}

async function searchWithTavily(query: string, apiKey: string, maxResults: number, timeout: number): Promise<WebSearchResult> {
    if (!apiKey) return { success: false, error: 'Tavily API Key not configured' }
    try {
        const body = JSON.stringify({ query, max_results: maxResults, api_key: apiKey })
        const { status, data } = await makePostRequest(
            'https://api.tavily.com/search',
            { 'Content-Type': 'application/json' },
            body,
            timeout,
        )
        if (status !== 200) return { success: false, error: `Tavily API returned status ${status}` }
        const json = JSON.parse(data)
        const results: SearchResult[] = []
        if (json.results) {
            for (const item of json.results.slice(0, maxResults)) {
                results.push({ title: item.title || '', url: item.url || '', snippet: item.content || '' })
            }
        }
        return { success: true, results }
    } catch (error) {
        return { success: false, error: `Tavily search failed: ${error}` }
    }
}

async function searchWithSerper(query: string, apiKey: string, maxResults: number, timeout: number): Promise<WebSearchResult> {
    if (!apiKey) return { success: false, error: 'Serper API Key not configured' }
    try {
        const body = JSON.stringify({ q: query, num: maxResults })
        const { status, data } = await makePostRequest(
            'https://google.serper.dev/search',
            { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
            body,
            timeout,
        )
        if (status !== 200) return { success: false, error: `Serper API returned status ${status}` }
        const json = JSON.parse(data)
        const results: SearchResult[] = []
        if (json.organic) {
            for (const item of json.organic.slice(0, maxResults)) {
                results.push({ title: item.title || '', url: item.link || '', snippet: item.snippet || '' })
            }
        }
        return { success: true, results }
    } catch (error) {
        return { success: false, error: `Serper search failed: ${error}` }
    }
}

async function searchWithJina(query: string, apiKey: string, maxResults: number, timeout: number): Promise<WebSearchResult> {
    if (!apiKey) return { success: false, error: 'Jina API Key not configured' }
    try {
        const encoded = encodeURIComponent(query)
        const { status, data } = await makeJsonRequest(
            `https://s.jina.ai/${encoded}?num=${maxResults}`,
            { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
            timeout,
        )
        if (status !== 200) return { success: false, error: `Jina API returned status ${status}` }
        const json = JSON.parse(data)
        const results: SearchResult[] = []
        if (json.data) {
            for (const item of json.data.slice(0, maxResults)) {
                results.push({ title: item.title || '', url: item.url || '', snippet: (item.description || item.content || '').slice(0, 300) })
            }
        }
        return { success: true, results }
    } catch (error) {
        return { success: false, error: `Jina search failed: ${error}` }
    }
}

async function searchWithExa(query: string, apiKey: string, maxResults: number, timeout: number): Promise<WebSearchResult> {
    if (!apiKey) return { success: false, error: 'Exa API Key not configured' }
    try {
        const body = JSON.stringify({ query, numResults: maxResults, type: 'auto', contents: { text: { maxCharacters: 300 } } })
        const { status, data } = await makePostRequest(
            'https://api.exa.ai/search',
            { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
            body,
            timeout,
        )
        if (status !== 200) return { success: false, error: `Exa API returned status ${status}` }
        const json = JSON.parse(data)
        const results: SearchResult[] = []
        if (json.results) {
            for (const item of json.results.slice(0, maxResults)) {
                results.push({ title: item.title || '', url: item.url || '', snippet: item.text || '' })
            }
        }
        return { success: true, results }
    } catch (error) {
        return { success: false, error: `Exa search failed: ${error}` }
    }
}

async function searchWithSogou(query: string, apiKey: string, maxResults: number, timeout: number): Promise<WebSearchResult> {
    if (!apiKey) return { success: false, error: 'Sogou API Key not configured' }
    try {
        const encoded = encodeURIComponent(query)
        const { status, data } = await makeJsonRequest(
            `https://api.sogou.com/search/v1?q=${encoded}&count=${maxResults}`,
            { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
            timeout,
        )
        if (status !== 200) return { success: false, error: `Sogou API returned status ${status}` }
        const json = JSON.parse(data)
        const results: SearchResult[] = []
        const items = json.data?.items || json.items || []
        for (const item of items.slice(0, maxResults)) {
            results.push({ title: item.title || '', url: item.url || item.link || '', snippet: item.abstract || item.snippet || item.content || '' })
        }
        return { success: true, results }
    } catch (error) {
        return { success: false, error: `Sogou search failed: ${error}` }
    }
}

async function searchWithBocha(query: string, apiKey: string, maxResults: number, timeout: number): Promise<WebSearchResult> {
    if (!apiKey) return { success: false, error: 'Bocha API Key not configured' }
    try {
        const body = JSON.stringify({ query, count: maxResults, freshness: 'noLimit' })
        const { status, data } = await makePostRequest(
            'https://api.bochaai.com/v1/web-search',
            { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body,
            timeout,
        )
        if (status !== 200) return { success: false, error: `Bocha API returned status ${status}` }
        const json = JSON.parse(data)
        const results: SearchResult[] = []
        const items = json.data?.webPages?.value || json.data?.items || []
        for (const item of items.slice(0, maxResults)) {
            results.push({ title: item.name || item.title || '', url: item.url || item.link || '', snippet: item.snippet || item.description || '' })
        }
        return { success: true, results }
    } catch (error) {
        return { success: false, error: `Bocha search failed: ${error}` }
    }
}

/**
 * 并行预取 top N 结果的网页摘要
 *
 * 对搜索结果的 URL 并行发起轻量级摘要抓取（使用 Jina Reader），
 * 限 6 秒超时、800 字符截断。失败的条目静默跳过，不影响整体结果。
 *
 * 设计目标：让 AI 一次获得带摘要的富结果，减少 read_url 二次抓取。
 */
async function prefetchContentSummaries(
    results: RichSearchResult[],
    topN: number,
    query: string,
): Promise<void> {
    const targets = results.slice(0, topN).filter(r => r.url && r.url.startsWith('http'))
    if (targets.length === 0) return

    // 快速预取：4 秒超时 + 80KB 下载限制 + gzip 压缩
    // 比旧方案（6 秒 + 500KB + 无压缩）快 3-5 倍
    const PREFETCH_TIMEOUT = 4000

    // 提取查询实体用于内容相关性评分
    const entityMatch = query.match(/[\u4e00-\u9fa5]{2,8}[0-9A-Za-z]*|[A-Z][a-z]+(?:[A-Z][a-z]+)*|[0-9]{4}/g) || []
    const entities = [...new Set(entityMatch.filter((e: string) => e.length >= 2 && !/^\d+$/.test(e)))]

    const tasks = targets.map(r =>
        fetchUrlFast(r.url, PREFETCH_TIMEOUT)
            .then(res => {
                if (res.success && res.content) {
                    // 智能内容提取：段落级相关性截取，替代原始 800 字符截断
                    const extracted = extractRelevantContent(res.content, query, entities, 1200)
                    if (extracted.summary) {
                        r.content = extracted.summary
                    } else {
                        // 兜底：原始截断
                        r.content = res.content.length > 800
                            ? res.content.slice(0, 800) + '…'
                            : res.content
                    }
                }
            })
            .catch(() => { /* 预取失败静默跳过 */ }),
    )

    await Promise.allSettled(tasks)
}

/**
 * 检测搜索结果与查询的相关性
 *
 * 解决 bing 引擎对长中文查询返回垃圾结果的问题：
 * - 中文查询但结果全是英文 → 不相关
 * - 查询实体在结果标题/摘要中完全没出现 → 不相关
 */
function isRelevantResults(query: string, results: RichSearchResult[]): boolean {
    if (results.length === 0) return false

    // 1. 语言不匹配检测：中文查询但结果全是英文
    const hasChineseQuery = /[\u4e00-\u9fa5]/.test(query)
    if (hasChineseQuery) {
        const chineseResultCount = results.filter(r =>
            /[\u4e00-\u9fa5]/.test(r.title) || /[\u4e00-\u9fa5]/.test(r.snippet)
        ).length
        // 中文查询但超过 70% 的结果是纯英文 → 不相关
        if (chineseResultCount < results.length * 0.3) {
            logger.ipc.warn(`[SearXNG] Language mismatch: query is Chinese but ${results.length - chineseResultCount}/${results.length} results are non-Chinese`)
            return false
        }
    }

    // 2. 实体匹配检测：提取查询中的关键词实体，检查结果是否包含
    const entityMatch = query.match(/[\u4e00-\u9fa5]{2,8}/g) || []
    const entities = [...new Set(entityMatch.filter((e: string) => e.length >= 2))].slice(0, 5)

    if (entities.length > 0) {
        let matchCount = 0
        for (const r of results.slice(0, 5)) {
            const text = (r.title + ' ' + r.snippet).toLowerCase()
            if (entities.some(e => text.includes(e.toLowerCase()))) {
                matchCount++
            }
        }
        // top 5 结果中没有任何一个包含查询实体 → 不相关
        if (matchCount === 0) {
            logger.ipc.warn(`[SearXNG] Entity mismatch: none of top 5 results contain query entities [${entities.join(', ')}]`)
            return false
        }
    }

    return true
}

/**
 * 过滤搜索引擎自身的搜索结果页 URL
 *
 * 这些 URL 是搜索引擎的搜索页面，不是实际内容页面：
 * - baidu.com/s? (百度搜索结果页)
 * - google.com/search
 * - bing.com/search
 * - yandex.com/search
 * - sogou.com/web
 * - so.com/s
 * - ai.so.com/search (360 系聚合跳转页：标题看似正常，点开是二次跳转)
 *
 * 这些页面 robots.txt 禁止抓取，且对用户无价值
 */
function filterSearchEngineUrls(results: RichSearchResult[]): RichSearchResult[] {
    const searchEnginePatterns = [
        /baidu\.com\/s\?/i,
        /baidu\.com\/link\?/i,
        /google\.\w+\/search\?/i,
        /google\.\w+\/url\?/i,
        /bing\.com\/search\?/i,
        /yandex\.\w+\/search\?/i,
        /sogou\.com\/web/i,
        /so\.com\/s\?/i,
        /\.so\.com\/search\//i,
        /duckduckgo\.com\//i,
    ]

    const filtered = results.filter(r => {
        const url = r.url || ''
        return !searchEnginePatterns.some(p => p.test(url))
    })

    if (filtered.length < results.length) {
        logger.ipc.info(`[SearXNG] Filtered ${results.length - filtered.length} search engine result pages`)
    }

    return filtered
}

/**
 * 精简查询：当长查询返回垃圾结果时，提取核心实体重新搜索
 *
 * 策略：
 * - 去除修饰词（最好吃的、推荐的等）
 * - 去除数字和特殊字符
 * - 保留核心中文实体
 * - 按 level 渐进精简
 */
function simplifyQuery(query: string, level: number = 1): string {
    // 修饰词列表（按长度降序排列，确保长的先匹配）
    const modifiers = [
        '最好吃的', '最好吃', '推荐的', '推荐', '最好的', '最好',
        '排行榜', '排行', '十大', '最新', '今日', '高端', '五星级',
        '性价比', '便宜', '正宗', '附近', '怎么样', '如何', '哪些',
        '哪家', '哪个', '什么', '多少', '多么', '求解', '求助',
    ]

    // Step 1: 去除修饰词
    let simplified = query
    for (const mod of modifiers) {
        simplified = simplified.split(mod).join('')
    }

    // Step 2: 去除数字、英文年份、特殊字符
    simplified = simplified.replace(/\b20\d{2}\b/g, '') // 去除年份 2024/2025/2026
    simplified = simplified.replace(/\b\d+\b/g, '')      // 去除独立数字
    simplified = simplified.replace(/[^\u4e00-\u9fa5a-zA-Z\s]/g, ' ') // 保留中英文和空格
    simplified = simplified.replace(/\s+/g, ' ').trim()  // 合并多余空格

    // Step 3: 提取中文实体词组
    const chineseWords = simplified.match(/[\u4e00-\u9fa5]{2,8}/g) || []

    // Step 4: 按级别精简
    let result: string
    if (level === 1) {
        // 第 1 级：保留前 3 个实体
        result = chineseWords.slice(0, 3).join(' ')
    } else if (level === 2) {
        // 第 2 级：只保留前 2 个核心实体
        result = chineseWords.slice(0, 2).join(' ')
    } else {
        // 第 3 级：只保留最重要的 1 个实体
        result = chineseWords[0] || ''
    }

    // 兜底：如果精简后为空，回退到原始查询的前几个词
    if (!result) {
        result = query.split(/\s+/).slice(0, level === 3 ? 1 : level === 2 ? 2 : 3).join(' ')
    }

    return result
}

/**
 * 按查询语言锁定结果集
 *
 * 中文查询显式限定 zh-CN，SearXNG 会据此跳过不支持中文的引擎，从源头减少
 * 「中文查询返回英文页面」这类无关结果；非中文查询交给 SearXNG 自动识别。
 */
function resolveSearchLanguage(query: string): string {
    return /[\u4e00-\u9fa5]/.test(query) ? 'zh-CN' : 'auto'
}

async function searchWithSearXNG(query: string, baseUrl: string, maxResults: number, timeout: number, apiKey?: string, page = 1): Promise<WebSearchResult> {
    if (!baseUrl) return { success: false, error: 'SearXNG instance URL not configured' }

    const cleanBase = baseUrl.replace(/\/+$/, '')
    const headers: Record<string, string> = { 'Accept': 'application/json' }
    if (apiKey) headers['X-API-Key'] = apiKey

    /**
     * 执行单次 SearXNG 搜索
     *
     * page 直接映射到 pageno，用于「加载更多」翻页；
     * 相关性重试沿用同一页，避免重试时跳页丢结果。
     */
    const doSearch = async (q: string): Promise<RichSearchResult[]> => {
        const encoded = encodeURIComponent(q)
        const { status, data } = await makeJsonRequest(
            `${cleanBase}/search?q=${encoded}&format=json&categories=general&pageno=${page}&language=${resolveSearchLanguage(q)}`,
            headers,
            timeout,
        )
        if (status !== 200) return []
        const json = JSON.parse(data)
        const results: RichSearchResult[] = []
        if (json.results) {
            for (const item of json.results.slice(0, maxResults)) {
                results.push({
                    title: item.title || '',
                    url: item.url || '',
                    snippet: item.content || '',
                    publishedDate: item.publishedDate || undefined,
                    engine: item.engine || undefined,
                    score: typeof item.score === 'number' ? item.score : undefined,
                })
            }
        }
        // 过滤搜索引擎自身的搜索结果页（baidu.com/s? 等）
        return filterSearchEngineUrls(results)
    }

    try {
        // 第 1 次搜索：使用原始查询
        let results = await doSearch(query)

        // 相关性检测：如果结果不相关，逐级精简查询重试
        if (results.length > 0 && !isRelevantResults(query, results)) {
            // 最多尝试 3 级精简
            for (let level = 1; level <= 3; level++) {
                const simplified = simplifyQuery(query, level)
                if (simplified === query || simplified.length === 0) break

                logger.ipc.info(`[SearXNG] Retry level ${level}: "${query}" → "${simplified}"`)
                const retryResults = await doSearch(simplified)

                if (retryResults.length > 0 && isRelevantResults(simplified, retryResults)) {
                    results = retryResults
                    logger.ipc.info(`[SearXNG] Retry level ${level} succeeded with ${results.length} relevant results`)
                    break
                }

                // 如果最后一级重试仍然不相关，但有结果，至少用重试结果（比垃圾结果好）
                if (level === 3 && retryResults.length > 0) {
                    results = retryResults
                    logger.ipc.warn(`[SearXNG] All retries failed relevance check, using last retry results (${results.length})`)
                }
            }
        }

        // 最终准入：逐条剔除与查询无关的结果
        //
        // 此前的做法是「整批判定 + 仅当整批不合格时才过滤」，只要靠前的结果里有
        // 一条命中实体，其余无关结果就会原样返回。改为对每条结果单独判定，相关性
        // 不达标的一律丢弃；若全部不达标则返回空，交由上层告知用户未找到相关结果，
        // 而不是用无关内容填充。
        if (results.length > 0) {
            const relevantOnly = results.filter(r => isRelevantItem(r.title, r.snippet || '', query))
            if (relevantOnly.length < results.length) {
                logger.ipc.info(`[SearXNG] Relevance filter: kept ${relevantOnly.length}/${results.length}`)
            }
            results = relevantOnly
        }

        // 并行预取 top 3 结果的网页摘要
        if (results.length > 0) {
            await prefetchContentSummaries(results, 3, query)
        }

        return { success: true, results }
    } catch (error) {
        return { success: false, error: `SearXNG search failed: ${error}` }
    }
}

/**
 * SearXNG 图片搜索
 *
 * 请求 categories=images，解析 img_src / thumbnail_src 等图片特有字段。
 */
async function searchImagesWithSearXNG(query: string, baseUrl: string, maxResults: number, timeout: number, apiKey?: string, page = 1): Promise<ImageSearchResult> {
    if (!baseUrl) return { success: false, error: 'SearXNG instance URL not configured' }
    try {
        const cleanBase = baseUrl.replace(/\/+$/, '')
        const encoded = encodeURIComponent(query)
        const headers: Record<string, string> = { 'Accept': 'application/json' }
        if (apiKey) headers['X-API-Key'] = apiKey
        const { status, data } = await makeJsonRequest(
            `${cleanBase}/search?q=${encoded}&format=json&categories=images&pageno=${page}&language=${resolveSearchLanguage(query)}`,
            headers,
            timeout,
        )
        if (status !== 200) return { success: false, error: `SearXNG returned status ${status}` }
        const json = JSON.parse(data)
        const results: ImageSearchResultItem[] = []
        if (json.results) {
            for (const item of json.results.slice(0, maxResults)) {
                const imgSrc = item.img_src || item.thumbnail_src || ''
                if (!imgSrc) continue
                results.push({
                    title: item.title || '',
                    url: item.url || item.img_src || '',
                    imgSrc,
                    thumbnailSrc: item.thumbnail_src || undefined,
                    source: item.engine || undefined,
                    imgSize: item.img_format || undefined,
                })
            }
        }
        return { success: true, results }
    } catch (error) {
        return { success: false, error: `SearXNG image search failed: ${error}` }
    }
}

/**
 * SearXNG 视频搜索
 *
 * 请求 categories=videos，解析 thumbnail / length / author 等视频特有字段。
 */
async function searchVideosWithSearXNG(query: string, baseUrl: string, maxResults: number, timeout: number, apiKey?: string, page = 1): Promise<VideoSearchResult> {
    if (!baseUrl) return { success: false, error: 'SearXNG instance URL not configured' }
    try {
        const cleanBase = baseUrl.replace(/\/+$/, '')
        const encoded = encodeURIComponent(query)
        const headers: Record<string, string> = { 'Accept': 'application/json' }
        if (apiKey) headers['X-API-Key'] = apiKey
        const { status, data } = await makeJsonRequest(
            `${cleanBase}/search?q=${encoded}&format=json&categories=videos&pageno=${page}&language=${resolveSearchLanguage(query)}`,
            headers,
            timeout,
        )
        if (status !== 200) return { success: false, error: `SearXNG returned status ${status}` }
        const json = JSON.parse(data)
        const results: VideoSearchResultItem[] = []
        if (json.results) {
            for (const item of json.results.slice(0, maxResults)) {
                results.push({
                    title: item.title || '',
                    url: item.url || '',
                    thumbnail: item.thumbnail || item.img_src || undefined,
                    length: item.length || undefined,
                    author: item.author || undefined,
                    source: item.engine || undefined,
                    publishedDate: item.publishedDate || undefined,
                })
            }
        }
        return { success: true, results }
    } catch (error) {
        return { success: false, error: `SearXNG video search failed: ${error}` }
    }
}


async function searchWithYandex(query: string, apiKey: string, maxResults: number, timeout: number): Promise<WebSearchResult> {
    if (!apiKey) return { success: false, error: 'Yandex API Key not configured' }
    try {
        const encoded = encodeURIComponent(query)
        const { status, data } = await makeJsonRequest(
            `https://yandex.com/search/xml?query=${encoded}&l10n=en&sortby=tm.order%3Dd&filter=strict&groupby=attr%3Dd.mode%3Ddeep.groups-on-page%3D${maxResults}`,
            { 'Api-Key': apiKey, 'Accept': 'application/json' },
            timeout,
        )
        if (status !== 200) return { success: false, error: `Yandex API returned status ${status}` }
        const results: SearchResult[] = []
        try {
            const urlMatches = data.match(/<url>([^<]+)<\/url>/gi) || []
            const titleMatches = data.match(/<title>([^<]+)<\/title>/gi) || []
            const snippetMatches = data.match(/<passage>([^<]+)<\/passage>/gi) || []
            for (let i = 0; i < Math.min(urlMatches.length, maxResults); i++) {
                const url = urlMatches[i].replace(/<\/?url>/gi, '')
                const title = (titleMatches[i] || '').replace(/<\/?title>/gi, '')
                const snippet = (snippetMatches[i] || '').replace(/<\/?passage>/gi, '')
                results.push({ title, url, snippet })
            }
        } catch {
            return { success: false, error: 'Failed to parse Yandex XML response' }
        }
        return { success: true, results }
    } catch (error) {
        return { success: false, error: `Yandex search failed: ${error}` }
    }
}

async function searchWithCustom(engineId: string, baseUrl: string, apiKey: string | undefined, query: string, maxResults: number, timeout: number): Promise<WebSearchResult> {
    try {
        const cleanBase = baseUrl.replace(/\/+$/, '')
        const encoded = encodeURIComponent(query)
        const headers: Record<string, string> = { 'Accept': 'application/json' }
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        const { status, data } = await makeJsonRequest(
            `${cleanBase}/search?q=${encoded}&count=${maxResults}`,
            headers,
            timeout,
        )
        if (status !== 200) return { success: false, error: `Custom engine ${engineId} returned status ${status}` }
        const json = JSON.parse(data)
        const results: SearchResult[] = []
        const items = json.results || json.data?.items || json.data?.webPages?.value || json.web?.results || json.organic || []
        for (const item of items.slice(0, maxResults)) {
            results.push({
                title: item.title || item.name || '',
                url: item.url || item.link || '',
                snippet: item.snippet || item.description || item.content || item.text || '',
            })
        }
        return { success: true, results }
    } catch (error) {
        return { success: false, error: `Custom engine ${engineId} failed: ${error}` }
    }
}

// Google Programmable Search Engine API
async function searchWithGoogle(query: string, apiKey: string, cx: string, maxResults: number, timeout = 15000): Promise<WebSearchResult> {
    return new Promise((resolve) => {
        const encodedQuery = encodeURIComponent(query)
        const url = `/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodedQuery}&num=${Math.min(maxResults, 10)}`

        const options = {
            hostname: 'www.googleapis.com',
            port: 443,
            path: url,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        }

        const req = https.request(options, (res) => {
            let data = ''
            res.on('data', (chunk) => data += chunk)
            res.on('end', () => {
                try {
                    const json = JSON.parse(data)

                    // 检查 API 错误
                    if (json.error) {
                        resolve({
                            success: false,
                            error: `Google API error: ${json.error.message || json.error.code}`
                        })
                        return
                    }

                    const results: SearchResult[] = []
                    if (json.items) {
                        for (const item of json.items.slice(0, maxResults)) {
                            results.push({
                                title: item.title || '',
                                url: item.link || '',
                                snippet: item.snippet || '',
                            })
                        }
                    }

                    resolve({ success: true, results })
                } catch {
                    resolve({ success: false, error: 'Failed to parse Google response' })
                }
            })
        })

        req.on('error', (error) => {
            resolve({ success: false, error: `Google request failed: ${error.message}` })
        })

        req.setTimeout(timeout, () => {
            req.destroy()
            resolve({ success: false, error: 'Google request timed out' })
        })

        req.end()
    })
}

// DuckDuckGo HTML 抓取
async function searchWithDuckDuckGo(query: string, maxResults: number, timeout = 25000): Promise<WebSearchResult> {
    return new Promise((resolve) => {
        const encodedQuery = encodeURIComponent(query)
        const url = `/html/?q=${encodedQuery}`

        const options = {
            hostname: 'html.duckduckgo.com',
            port: 443,
            path: url,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://html.duckduckgo.com/',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'same-origin',
                'Upgrade-Insecure-Requests': '1',
            },
        }

        const req = https.request(options, (res) => {
            let data = ''
            res.setEncoding('utf8')
            res.on('data', (chunk) => data += chunk)
            res.on('end', () => {
                try {
                    const results = parseDuckDuckGoHtml(data, maxResults)
                    if (results.length === 0) {
                        logger.ipc.warn('[HTTP] DuckDuckGo returned 0 results, response length:', data.length)
                    }
                    resolve({ success: true, results })
                } catch (error) {
                    resolve({ success: false, error: `Failed to parse DuckDuckGo response: ${error}` })
                }
            })
        })

        req.on('error', (error) => {
            resolve({ success: false, error: `DuckDuckGo request failed: ${error.message}` })
        })

        req.setTimeout(timeout, () => {
            req.destroy()
            resolve({ success: false, error: 'DuckDuckGo request timed out' })
        })

        req.end()
    })
}

// 解析 DuckDuckGo HTML 响应
function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = []

    // DuckDuckGo HTML 版本的结果在 class="result" 的 div 中
    // 标题在 class="result__a" 的 a 标签中
    // 摘要在 class="result__snippet" 的 a 标签中

    // 匹配结果块
    const resultRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi

    let match
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        let url = match[1]
        const title = stripHtml(decodeHtmlEntities(match[2].trim()))
        const snippet = stripHtml(decodeHtmlEntities(match[3].trim()))

        // DuckDuckGo 的链接是重定向链接，需要提取真实 URL
        if (url.includes('uddg=')) {
            const uddgMatch = url.match(/uddg=([^&]+)/)
            if (uddgMatch) {
                url = decodeURIComponent(uddgMatch[1])
            }
        }

        if (title && url) {
            results.push({ title, url, snippet })
        }
    }

    // 如果上面的正则没匹配到，尝试更宽松的匹配
    if (results.length === 0) {
        const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
        const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi

        const links: { url: string; title: string }[] = []
        const snippets: string[] = []

        while ((match = linkRegex.exec(html)) !== null) {
            let url = match[1]
            if (url.includes('uddg=')) {
                const uddgMatch = url.match(/uddg=([^&]+)/)
                if (uddgMatch) url = decodeURIComponent(uddgMatch[1])
            }
            links.push({ url, title: stripHtml(decodeHtmlEntities(match[2].trim())) })
        }

        while ((match = snippetRegex.exec(html)) !== null) {
            snippets.push(stripHtml(decodeHtmlEntities(match[1].trim())))
        }

        for (let i = 0; i < Math.min(links.length, maxResults); i++) {
            results.push({
                title: links[i].title,
                url: links[i].url,
                snippet: snippets[i] || '',
            })
        }
    }

    return results
}

// 移除 HTML 标签
function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, '').trim()
}

// Bing 搜索（国内可直接访问，无需 API Key）
// 注意：www.bing.com 在国内会 302 重定向到 cn.bing.com，Node.js 默认不跟随重定向，
// 因此默认使用 cn.bing.com 避免重定向，同时实现重定向跟随作为兜底
async function searchWithBing(query: string, maxResults: number, timeout = 25000): Promise<WebSearchResult> {
    const encodedQuery = encodeURIComponent(query)
    const path = `/search?q=${encodedQuery}&count=${Math.min(maxResults, 10)}`
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
    }

    // 默认使用 cn.bing.com（国内可直连，避免 302 重定向）
    // 若被重定向，则跟随 location 最多 3 次
    let hostname = 'cn.bing.com'
    let currentPath = path
    const maxRedirects = 3

    for (let attempt = 0; attempt <= maxRedirects; attempt++) {
        const result = await makeBingRequest(hostname, currentPath, headers, timeout)
        if (!result.redirect) {
            // 非重定向，解析结果
            if (result.status !== 200) {
                logger.ipc.warn(`[HTTP] Bing returned status ${result.status}, body length: ${result.data.length}`)
            }
            try {
                const results = parseBingHtml(result.data, maxResults)
                if (results.length === 0) {
                    logger.ipc.warn('[HTTP] Bing returned 0 results, response length:', result.data.length)
                }
                return { success: true, results }
            } catch (error) {
                return { success: false, error: `Failed to parse Bing response: ${error}` }
            }
        }
        // 处理重定向
        const location = result.redirect
        logger.ipc.debug(`[HTTP] Bing redirect (${attempt + 1}/${maxRedirects}): ${hostname} -> ${location}`)
        try {
            const parsed = new URL(location)
            hostname = parsed.hostname
            currentPath = parsed.pathname + parsed.search
        } catch {
            // 无效的 location URL
            return { success: false, error: `Bing returned invalid redirect: ${location}` }
        }
    }
    return { success: false, error: `Bing search exceeded max redirects (${maxRedirects})` }
}

// 发起单次 Bing 请求，返回响应数据或重定向地址
function makeBingRequest(
    hostname: string,
    path: string,
    headers: Record<string, string>,
    timeout: number,
): Promise<{ status: number; data: string; redirect?: string }> {
    return new Promise((resolve) => {
        const options = {
            hostname,
            port: 443,
            path,
            method: 'GET',
            headers,
        }

        const req = https.request(options, (res) => {
            // 3xx 重定向：返回 location
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume() // 丢弃响应体
                resolve({ status: res.statusCode, data: '', redirect: res.headers.location })
                return
            }
            let data = ''
            res.setEncoding('utf8')
            res.on('data', (chunk) => data += chunk)
            res.on('end', () => resolve({ status: res.statusCode || 0, data }))
        })

        req.on('error', (error) => resolve({ status: 0, data: error.message }))
        req.setTimeout(timeout, () => {
            req.destroy()
            resolve({ status: 0, data: 'Bing request timed out' })
        })
        req.end()
    })
}

// 解析 Bing HTML 响应
function parseBingHtml(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = []

    // Bing 结果在 class="b_algo" 的 li 中
    // 标题在 h2 > a 中（跳过 class="tilk" 的站点链接）
    // 摘要在 class="b_caption" 的 p 中
    const resultRegex = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<h2[^>]*>[\s\S]*?<a(?![^>]*class="tilk")[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi

    let match
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1]
        const title = stripHtml(decodeHtmlEntities(match[2].trim()))
        const snippet = stripHtml(decodeHtmlEntities(match[3].trim()))

        if (title && url) {
            results.push({ title, url, snippet })
        }
    }

    // 回退：更宽松的匹配
    if (results.length === 0) {
        const algoRegex = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<\/li>/gi
        let algoMatch
        while ((algoMatch = algoRegex.exec(html)) !== null && results.length < maxResults) {
            const block = algoMatch[0]
            // 优先匹配 h2 内的链接（跳过 tilk 站点链接）
            const h2Match = block.match(/<h2[^>]*>[\s\S]*?<a(?![^>]*class="tilk")[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i)
            const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
            if (h2Match) {
                results.push({
                    title: stripHtml(decodeHtmlEntities(h2Match[2].trim())),
                    url: h2Match[1],
                    snippet: snippetMatch ? stripHtml(decodeHtmlEntities(snippetMatch[1].trim())) : '',
                })
            }
        }
    }

    return results
}

// 解码 HTML 实体
function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
}

// ===== 图片/视频搜索 =====

/**
 * 图片搜索
 *
 * 当前仅支持 SearXNG（categories=images）。
 * 非 SearXNG 引擎返回不支持错误，后续可按需扩展。
 */
async function imageSearch(query: string, maxResults = 5, timeout?: number, page = 1): Promise<ImageSearchResult> {
    const engineOrder = getEnabledEngineOrder()
    const globalTimeout = timeout !== undefined && timeout !== null
        ? timeout
        : (cachedSearchEngineState?.searchTimeout ?? 30) * 1000
    const perEngineTimeout = globalTimeout > 0
        ? Math.max(Math.floor(globalTimeout / Math.min(engineOrder.length, 3)), 8000)
        : 0

    for (const engineId of engineOrder) {
        // 图片搜索目前仅支持 SearXNG 系引擎
        if (engineId !== 'aweeclaw-searxng' && engineId !== 'searxng') continue

        const cfg = getEngineConfig(engineId)
        const baseUrl = cfg.extraValues?.baseUrl || cfg.customBaseUrl || ''
        const engineTimeout = cfg.timeout ? cfg.timeout * 1000 : perEngineTimeout

        try {
            const result = await searchImagesWithSearXNG(
                query, baseUrl, maxResults, engineTimeout, cfg.apiKey, page,
            )
            if (result.success && result.results && result.results.length > 0) {
                logger.ipc.info(`[HTTP] Image search succeeded with engine: ${engineId}, results: ${result.results.length}`)
                return result
            }
            logger.ipc.warn(`[HTTP] Image search engine ${engineId} returned no results: ${result.error || 'empty'}`)
        } catch (error) {
            logger.ipc.warn(`[HTTP] Image search engine ${engineId} failed:`, error instanceof Error ? error.message : String(error))
        }
    }

    return { success: false, error: '没有支持图片搜索的搜索引擎（需要 SearXNG 系引擎）' }
}

/**
 * 视频搜索
 *
 * 当前仅支持 SearXNG（categories=videos）。
 */
async function videoSearch(query: string, maxResults = 5, timeout?: number, page = 1): Promise<VideoSearchResult> {
    const engineOrder = getEnabledEngineOrder()
    const globalTimeout = timeout !== undefined && timeout !== null
        ? timeout
        : (cachedSearchEngineState?.searchTimeout ?? 30) * 1000
    const perEngineTimeout = globalTimeout > 0
        ? Math.max(Math.floor(globalTimeout / Math.min(engineOrder.length, 3)), 8000)
        : 0

    for (const engineId of engineOrder) {
        if (engineId !== 'aweeclaw-searxng' && engineId !== 'searxng') continue

        const cfg = getEngineConfig(engineId)
        const baseUrl = cfg.extraValues?.baseUrl || cfg.customBaseUrl || ''
        const engineTimeout = cfg.timeout ? cfg.timeout * 1000 : perEngineTimeout

        try {
            const result = await searchVideosWithSearXNG(
                query, baseUrl, maxResults, engineTimeout, cfg.apiKey, page,
            )
            if (result.success && result.results && result.results.length > 0) {
                logger.ipc.info(`[HTTP] Video search succeeded with engine: ${engineId}, results: ${result.results.length}`)
                return result
            }
            logger.ipc.warn(`[HTTP] Video search engine ${engineId} returned no results: ${result.error || 'empty'}`)
        } catch (error) {
            logger.ipc.warn(`[HTTP] Video search engine ${engineId} failed:`, error instanceof Error ? error.message : String(error))
        }
    }

    return { success: false, error: '没有支持视频搜索的搜索引擎（需要 SearXNG 系引擎）' }
}

// ===== 远程文件下载（图片 / 视频 / 附件） =====

/** 单文件下载体积上限：500MB，防止大文件把内存打满 */
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024

/** 建连/首包超时；流式接收期间不重置，避免大文件被误杀 */
const DOWNLOAD_REQUEST_TIMEOUT = 60000

/** 体积文案（错误提示用） */
function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`
}

/** 常见 MIME → 扩展名：URL 路径没有扩展名时，用服务端 Content-Type 兜底 */
const DOWNLOAD_EXT_BY_MIME: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
    'video/x-msvideo': '.avi',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/flac': '.flac',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
}

/** 取 URL 路径最后一段的扩展名（命中才返回，形如 `.jpg`） */
function extensionFromUrl(url: string): string {
    try {
        const segment = new URL(url).pathname.split('/').filter(Boolean).pop() || ''
        const matched = segment.match(/\.[A-Za-z0-9]{1,8}$/)
        return matched ? matched[0].toLowerCase() : ''
    } catch {
        return ''
    }
}

/** 文件名是否已带扩展名 */
function hasExtension(name: string): boolean {
    return /\.[A-Za-z0-9]{1,8}$/.test(name)
}

/**
 * 推导落地文件名
 *
 * 优先用调用方给的 suggestedName（通常是结果标题），否则取 URL 最后一段路径；
 * 统一去掉查询串并替换文件系统非法字符，避免保存到非预期目录。
 *
 * 标题类建议名几乎不带扩展名，落地后系统无法识别文件类型（图片打不开），
 * 因此缺扩展名时依次用 URL 路径、服务端 Content-Type 补全。
 */
function resolveDownloadName(url: string, suggestedName?: string, contentType?: string): string {
    let name = (suggestedName || '').trim()
    if (!name) {
        try {
            const pathname = new URL(url).pathname
            name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '')
        } catch {
            name = ''
        }
    }
    name = name.split(/[?#]/)[0].replace(/[\\/:*?"<>|]/g, '_').trim()

    if (name && !hasExtension(name)) {
        const mime = (contentType || '').split(';')[0].trim().toLowerCase()
        const ext = extensionFromUrl(url) || DOWNLOAD_EXT_BY_MIME[mime] || ''
        if (ext) name += ext
    }

    return name || 'download'
}

/**
 * 流式抓取远程二进制内容到内存
 *
 * - 携带浏览器 UA，并按需附加 Referer，绕过常见图片/视频防盗链
 * - 声明 Accept-Encoding: identity，二进制原样落地、不做解压
 * - 接收过程中累计超过体积上限立即中断连接
 */
function fetchRemoteBuffer(
    url: string,
    referer: string | undefined,
    maxBytes: number,
    redirectDepth = 0,
): Promise<{ success: boolean; data?: Buffer; error?: string; contentType?: string }> {
    return new Promise((resolve) => {
        let settled = false
        const done = (r: { success: boolean; data?: Buffer; error?: string; contentType?: string }) => {
            if (settled) return
            settled = true
            resolve(r)
        }

        let parsed: URL
        try {
            parsed = new URL(url)
        } catch {
            done({ success: false, error: `无效的下载地址: ${url}` })
            return
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            done({ success: false, error: `仅支持 http/https 下载，当前为 ${parsed.protocol}` })
            return
        }

        const lib = parsed.protocol === 'https:' ? https : http
        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
        }
        if (referer) headers['Referer'] = referer

        const req = lib.get(
            {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                headers,
            },
            (res) => {
                const status = res.statusCode || 0

                // 跟随重定向（最多 5 跳，防止死循环）
                if (status >= 300 && status < 400 && res.headers.location) {
                    res.resume()
                    if (redirectDepth >= 5) {
                        done({ success: false, error: '重定向次数过多，已放弃下载' })
                        return
                    }
                    const nextUrl = new URL(res.headers.location, parsed).toString()
                    fetchRemoteBuffer(nextUrl, referer, maxBytes, redirectDepth + 1).then(done)
                    return
                }

                if (status < 200 || status >= 300) {
                    res.resume()
                    done({ success: false, error: `下载失败：HTTP ${status}` })
                    return
                }

                const contentType = String(res.headers['content-type'] || '')
                const contentLength = Number(res.headers['content-length'] || 0)
                if (contentLength > maxBytes) {
                    res.destroy()
                    done({ success: false, error: `文件体积 ${formatBytes(contentLength)} 超过上限 ${formatBytes(maxBytes)}` })
                    return
                }

                const chunks: Buffer[] = []
                let received = 0
                res.on('data', (chunk: Buffer) => {
                    received += chunk.length
                    if (received > maxBytes) {
                        res.destroy()
                        done({ success: false, error: `文件体积超过上限 ${formatBytes(maxBytes)}，已中断下载` })
                        return
                    }
                    chunks.push(chunk)
                })
                res.on('end', () => done({ success: true, data: Buffer.concat(chunks), contentType }))
                res.on('error', (err: Error) => done({ success: false, error: err.message }))
            },
        )

        req.on('error', (err: Error) => done({ success: false, error: err.message }))
        req.setTimeout(DOWNLOAD_REQUEST_TIMEOUT, () => {
            req.destroy()
            done({ success: false, error: '下载超时，请检查网络或换用其它来源' })
        })
    })
}

/**
 * 下载远程文件
 *
 * 流程：流式抓取到内存（带体积上限）→ 系统保存对话框选路径 → 写盘。
 * 先抓取再弹框：直链失效 / 防盗链时直接返回错误，不弹出无意义的保存对话框。
 */
async function downloadRemoteFile(
    url: string,
    suggestedName?: string,
    referer?: string,
    parentWindow?: BrowserWindow,
): Promise<{ success: boolean; path?: string; error?: string; canceled?: boolean }> {
    if (!url || typeof url !== 'string') {
        return { success: false, error: '缺少下载地址' }
    }

    const fetched = await fetchRemoteBuffer(url, referer, MAX_DOWNLOAD_BYTES)
    if (!fetched.success || !fetched.data) {
        return { success: false, error: fetched.error || '下载失败' }
    }

    const options = {
        title: '保存文件',
        defaultPath: resolveDownloadName(url, suggestedName, fetched.contentType),
        filters: [{ name: '所有文件', extensions: ['*'] }],
    }
    const saveResult = parentWindow
        ? await dialog.showSaveDialog(parentWindow, options)
        : await dialog.showSaveDialog(options)

    if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true }
    }

    try {
        await fs.promises.writeFile(saveResult.filePath, fetched.data)
        logger.ipc.info(`[HTTP] Remote file saved: ${saveResult.filePath} (${formatBytes(fetched.data.length)})`)
        return { success: true, path: saveResult.filePath }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        logger.ipc.warn('[HTTP] Failed to save remote file:', msg)
        return { success: false, error: `保存失败：${msg}` }
    }
}

// ===== 注册 IPC Handlers =====

export function registerHttpHandlers() {
    // 注入搜索函数到智能搜索分发器（避免循环依赖）
    smartSearchDispatcher.injectSearchFunctions({
        generalSearch: async (query, maxResults, timeout?, page?) => {
            const result = await webSearch(query, maxResults, timeout, page)
            return {
                success: result.success,
                results: result.results as Array<{ title: string; url: string; snippet: string; content?: string; publishedDate?: string; engine?: string; score?: number }> | undefined,
                error: result.error,
            }
        },
        imageSearch: async (query, maxResults, timeout?, page?) => {
            const result = await imageSearch(query, maxResults, timeout, page)
            return {
                success: result.success,
                results: result.results as Array<{ title: string; url: string; imgSrc: string; thumbnailSrc?: string; source?: string }> | undefined,
                error: result.error,
            }
        },
        videoSearch: async (query, maxResults, timeout?, page?) => {
            const result = await videoSearch(query, maxResults, timeout, page)
            return {
                success: result.success,
                results: result.results as Array<{ title: string; url: string; thumbnail?: string; length?: string; author?: string; source?: string; publishedDate?: string }> | undefined,
                error: result.error,
            }
        },
    })

    // 读取 URL 内容
    safeIpcHandle('http:readUrl', async (_event, url: string, timeout?: number) => {
        logger.ipc.info('[HTTP] Reading URL:', url)
        return fetchUrl(url, timeout)
    })

    // 网络搜索（page 用于「加载更多」翻页，从 1 开始）
    safeIpcHandle('http:webSearch', async (_event, query: string, maxResults?: number, timeout?: number, page?: number) => {
        logger.ipc.info('[HTTP] Web search:', query, 'timeout:', timeout, 'page:', page)
        return webSearch(query, maxResults, timeout, page)
    })

    // 智能搜索（领域识别 + 垂直源分发）；domain 可选用于强制指定领域，page 用于翻页
    safeIpcHandle('http:smartSearch', async (_event, query: string, maxResults?: number, domain?: string, page?: number) => {
        logger.ipc.info('[HTTP] Smart search:', query, 'maxResults:', maxResults, 'domain:', domain, 'page:', page)
        return smartSearchDispatcher.search(query, maxResults || 8, domain as SearchDomain | undefined, page)
    })

    // 图片搜索
    safeIpcHandle('http:imageSearch', async (_event, query: string, maxResults?: number, timeout?: number, page?: number) => {
        logger.ipc.info('[HTTP] Image search:', query, 'timeout:', timeout, 'page:', page)
        return imageSearch(query, maxResults, timeout, page)
    })

    // 视频搜索
    safeIpcHandle('http:videoSearch', async (_event, query: string, maxResults?: number, timeout?: number, page?: number) => {
        logger.ipc.info('[HTTP] Video search:', query, 'timeout:', timeout, 'page:', page)
        return videoSearch(query, maxResults, timeout, page)
    })

    // 下载远程文件（图片/视频/附件）：拉取二进制后由用户选择保存位置
    safeIpcHandle('http:downloadFile', async (event, url: string, suggestedName?: string, referer?: string) => {
        logger.ipc.info('[HTTP] Download file:', url)
        // 以发起窗口为父窗口，macOS 上保存对话框会以 sheet 形式附着在其上
        const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
        return downloadRemoteFile(url, suggestedName, referer, parentWindow)
    })

    // 配置搜索引擎状态
    safeIpcHandle('http:setSearchEngineState', async (_event, state: SearchEngineState) => {
        setSearchEngineState(state)
        return { success: true }
    })

    logger.ipc.info('[HTTP] IPC handlers registered')
}



