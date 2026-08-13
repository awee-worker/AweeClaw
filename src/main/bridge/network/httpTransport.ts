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
import { extractRelevantContent } from './verticalSearch/contentExtractor'
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

async function webSearch(query: string, maxResults = 5, timeout?: number): Promise<WebSearchResult> {
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
            const result = await executeSearch(engineId, query, maxResults, perEngineTimeout)
            if (result.success && result.results && result.results.length > 0) {
                logger.ipc.info(`[HTTP] Search succeeded with engine: ${engineId}, results: ${result.results.length}`)
                return result
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

async function executeSearch(engineId: string, query: string, maxResults: number, timeout: number): Promise<WebSearchResult> {
    const cfg = getEngineConfig(engineId)
    const engineTimeout = cfg.timeout ? cfg.timeout * 1000 : timeout

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
        case 'searxng': return searchWithSearXNG(query, cfg.extraValues?.baseUrl || cfg.customBaseUrl || '', maxResults, engineTimeout, cfg.apiKey)
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

async function searchWithSearXNG(query: string, baseUrl: string, maxResults: number, timeout: number, apiKey?: string): Promise<WebSearchResult> {
    if (!baseUrl) return { success: false, error: 'SearXNG instance URL not configured' }
    try {
        const cleanBase = baseUrl.replace(/\/+$/, '')
        const encoded = encodeURIComponent(query)
        const headers: Record<string, string> = { 'Accept': 'application/json' }
        // AweeClaw 官方实例和需要鉴权的 SearXNG 实例通过 X-API-Key 头认证
        if (apiKey) headers['X-API-Key'] = apiKey
        const { status, data } = await makeJsonRequest(
            `${cleanBase}/search?q=${encoded}&format=json&categories=general&pageno=1`,
            headers,
            timeout,
        )
        if (status !== 200) return { success: false, error: `SearXNG returned status ${status}` }
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

        // 并行预取 top 3 结果的网页摘要，减少 AI 后续 read_url 调用
        // 预取不阻塞错误路径，仅在结果非空时执行
        // 智能内容提取：段落级相关性截取，替代原始字符截断
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
async function searchImagesWithSearXNG(query: string, baseUrl: string, maxResults: number, timeout: number, apiKey?: string): Promise<ImageSearchResult> {
    if (!baseUrl) return { success: false, error: 'SearXNG instance URL not configured' }
    try {
        const cleanBase = baseUrl.replace(/\/+$/, '')
        const encoded = encodeURIComponent(query)
        const headers: Record<string, string> = { 'Accept': 'application/json' }
        if (apiKey) headers['X-API-Key'] = apiKey
        const { status, data } = await makeJsonRequest(
            `${cleanBase}/search?q=${encoded}&format=json&categories=images&pageno=1`,
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
async function searchVideosWithSearXNG(query: string, baseUrl: string, maxResults: number, timeout: number, apiKey?: string): Promise<VideoSearchResult> {
    if (!baseUrl) return { success: false, error: 'SearXNG instance URL not configured' }
    try {
        const cleanBase = baseUrl.replace(/\/+$/, '')
        const encoded = encodeURIComponent(query)
        const headers: Record<string, string> = { 'Accept': 'application/json' }
        if (apiKey) headers['X-API-Key'] = apiKey
        const { status, data } = await makeJsonRequest(
            `${cleanBase}/search?q=${encoded}&format=json&categories=videos&pageno=1`,
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
async function imageSearch(query: string, maxResults = 5, timeout?: number): Promise<ImageSearchResult> {
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
                query, baseUrl, maxResults, engineTimeout, cfg.apiKey,
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
async function videoSearch(query: string, maxResults = 5, timeout?: number): Promise<VideoSearchResult> {
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
                query, baseUrl, maxResults, engineTimeout, cfg.apiKey,
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

// ===== 注册 IPC Handlers =====

export function registerHttpHandlers() {
    // 注入搜索函数到智能搜索分发器（避免循环依赖）
    smartSearchDispatcher.injectSearchFunctions({
        generalSearch: async (query, maxResults, timeout?) => {
            const result = await webSearch(query, maxResults, timeout)
            return {
                success: result.success,
                results: result.results as Array<{ title: string; url: string; snippet: string; content?: string; publishedDate?: string; engine?: string; score?: number }> | undefined,
                error: result.error,
            }
        },
        imageSearch: async (query, maxResults, timeout?) => {
            const result = await imageSearch(query, maxResults, timeout)
            return {
                success: result.success,
                results: result.results as Array<{ title: string; url: string; imgSrc: string; thumbnailSrc?: string; source?: string }> | undefined,
                error: result.error,
            }
        },
        videoSearch: async (query, maxResults, timeout?) => {
            const result = await videoSearch(query, maxResults, timeout)
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

    // 网络搜索
    safeIpcHandle('http:webSearch', async (_event, query: string, maxResults?: number, timeout?: number) => {
        logger.ipc.info('[HTTP] Web search:', query, 'timeout:', timeout)
        return webSearch(query, maxResults, timeout)
    })

    // 智能搜索（领域识别 + 垂直源分发）
    safeIpcHandle('http:smartSearch', async (_event, query: string, maxResults?: number) => {
        logger.ipc.info('[HTTP] Smart search:', query, 'maxResults:', maxResults)
        return smartSearchDispatcher.search(query, maxResults || 8)
    })

    // 图片搜索
    safeIpcHandle('http:imageSearch', async (_event, query: string, maxResults?: number, timeout?: number) => {
        logger.ipc.info('[HTTP] Image search:', query, 'timeout:', timeout)
        return imageSearch(query, maxResults, timeout)
    })

    // 视频搜索
    safeIpcHandle('http:videoSearch', async (_event, query: string, maxResults?: number, timeout?: number) => {
        logger.ipc.info('[HTTP] Video search:', query, 'timeout:', timeout)
        return videoSearch(query, maxResults, timeout)
    })

    // 配置搜索引擎状态
    safeIpcHandle('http:setSearchEngineState', async (_event, state: SearchEngineState) => {
        setSearchEngineState(state)
        return { success: true }
    })

    logger.ipc.info('[HTTP] IPC handlers registered')
}



