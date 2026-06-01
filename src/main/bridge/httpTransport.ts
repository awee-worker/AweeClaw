/**
 * HTTP 服务 IPC handlers
 * 提供网络请求能力给渲染进程
 */

import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from './ipcGuard'
import * as https from 'https'
import * as http from 'http'
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
 * 使用 Jina Reader API 读取 URL 内容
 * Jina Reader 专为 LLM 优化，支持 JS 渲染页面
 * 免费无限制使用
 */
async function fetchWithJinaReader(url: string, timeout = 60000): Promise<ReadUrlResult> {
    return new Promise((resolve) => {
        const options = {
            hostname: 'r.jina.ai',
            port: 443,
            path: `/${url}`,
            method: 'GET',
            headers: {
                'Accept': 'text/plain',
                'User-Agent': 'AweeClaw/1.0 (AI Agent Platform)',
            },
            timeout,
        }

        const req = https.request(options, (res) => {
            let data = ''
            res.setEncoding('utf8')

            res.on('data', (chunk) => {
                data += chunk
                // 限制响应大小
                if (data.length > 500000) {
                    req.destroy()
                    resolve({
                        success: true,
                        content: data.slice(0, 500000) + '\n\n...(truncated, content too large)',
                        statusCode: res.statusCode,
                        contentType: 'text/plain',
                    })
                }
            })

            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 400) {
                    resolve({
                        success: false,
                        error: `Jina Reader returned status ${res.statusCode}`,
                        statusCode: res.statusCode,
                    })
                    return
                }

                // 从 Jina 返回的 Markdown 中提取标题
                let title = ''
                const titleMatch = data.match(/^#\s+(.+)$/m)
                if (titleMatch) {
                    title = titleMatch[1].trim()
                }

                resolve({
                    success: true,
                    content: data,
                    title,
                    statusCode: res.statusCode,
                    contentType: 'text/markdown',
                })
            })
        })

        req.on('error', (error) => {
            resolve({
                success: false,
                error: `Jina Reader request failed: ${error.message}`,
            })
        })

        req.on('timeout', () => {
            req.destroy()
            resolve({
                success: false,
                error: 'Jina Reader request timed out',
            })
        })

        req.end()
    })
}

/**
 * 直接抓取 URL 内容（备用方案）
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

                let data = ''
                const contentType = res.headers['content-type'] || ''

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

                res.setEncoding('utf8')
                res.on('data', (chunk) => {
                    data += chunk
                    // 限制响应大小
                    if (data.length > 500000) {
                        req.destroy()
                        resolve({
                            success: true,
                            content: data.slice(0, 500000) + '\n\n...(truncated, content too large)',
                            statusCode: res.statusCode,
                            contentType,
                        })
                    }
                })

                res.on('end', () => {
                    // 提取 HTML 标题
                    let title = ''
                    const titleMatch = data.match(/<title[^>]*>([^<]+)<\/title>/i)
                    if (titleMatch) {
                        title = titleMatch[1].trim()
                    }

                    // HTML 到文本转换
                    let content = data
                    if (contentType.includes('html')) {
                        content = htmlToText(data)
                    }

                    resolve({
                        success: true,
                        content,
                        title,
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
 * 读取 URL 内容
 * 优先使用 Jina Reader，失败时回退到直接抓取
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

    // 优先使用 Jina Reader
    logger.ipc.debug('[HTTP] Trying Jina Reader for:', url)
    const jinaResult = await fetchWithJinaReader(url, timeout)

    if (jinaResult.success) {
        logger.ipc.debug('[HTTP] Jina Reader succeeded')
        return jinaResult
    }

    // Jina 失败，回退到直接抓取
    logger.ipc.warn('[HTTP] Jina Reader failed, falling back to direct fetch:', jinaResult.error)
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

interface WebSearchResult {
    success: boolean
    results?: SearchResult[]
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
        return ['duckduckgo']
    }
    const engines = cachedSearchEngineState.searchEngines
    const enabled = Object.entries(engines)
        .filter(([, cfg]) => cfg.enabled)
        .map(([id]) => id)

    if (enabled.length === 0) return ['duckduckgo']

    const active = cachedSearchEngineState.activeSearchEngine
    if (active && enabled.includes(active)) {
        const rest = enabled.filter(id => id !== active)
        return [active, ...rest]
    }

    const priority = ['google', 'brave', 'tavily', 'bing', 'serper', 'jina', 'exa', 'sogou', 'bocha', 'searxng', 'yandex', 'duckduckgo']
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
    return cachedSearchEngineState?.searchEngines?.[engineId] || {}
}

async function webSearch(query: string, maxResults = 5, timeout?: number): Promise<WebSearchResult> {
    const engineOrder = getEnabledEngineOrder()
    const globalTimeout = timeout || ((cachedSearchEngineState?.searchTimeout ?? 30) * 1000)
    const perEngineTimeout = Math.max(Math.floor(globalTimeout / Math.min(engineOrder.length, 3)), 8000)

    const errors: string[] = []

    for (const engineId of engineOrder) {
        try {
            const result = await executeSearch(engineId, query, maxResults, perEngineTimeout)
            if (result.success && result.results && result.results.length > 0) {
                logger.ipc.info(`[HTTP] Search succeeded with engine: ${engineId}, results: ${result.results.length}`)
                return result
            }
            if (result.error) {
                errors.push(`${engineId}: ${result.error}`)
            }
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
        case 'searxng': return searchWithSearXNG(query, cfg.extraValues?.baseUrl || cfg.customBaseUrl || '', maxResults, engineTimeout)
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

async function searchWithSearXNG(query: string, baseUrl: string, maxResults: number, timeout: number): Promise<WebSearchResult> {
    if (!baseUrl) return { success: false, error: 'SearXNG instance URL not configured' }
    try {
        const cleanBase = baseUrl.replace(/\/+$/, '')
        const encoded = encodeURIComponent(query)
        const { status, data } = await makeJsonRequest(
            `${cleanBase}/search?q=${encoded}&format=json&categories=general&pageno=1`,
            { 'Accept': 'application/json' },
            timeout,
        )
        if (status !== 200) return { success: false, error: `SearXNG returned status ${status}` }
        const json = JSON.parse(data)
        const results: SearchResult[] = []
        if (json.results) {
            for (const item of json.results.slice(0, maxResults)) {
                results.push({ title: item.title || '', url: item.url || '', snippet: item.content || '' })
            }
        }
        return { success: true, results }
    } catch (error) {
        return { success: false, error: `SearXNG search failed: ${error}` }
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

// Bing 搜索（国内可访问）
async function searchWithBing(query: string, maxResults: number, timeout = 25000): Promise<WebSearchResult> {
    return new Promise((resolve) => {
        const encodedQuery = encodeURIComponent(query)
        const url = `/search?q=${encodedQuery}&count=${Math.min(maxResults, 10)}`

        const options = {
            hostname: 'www.bing.com',
            port: 443,
            path: url,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
            },
        }

        const req = https.request(options, (res) => {
            let data = ''
            res.setEncoding('utf8')
            res.on('data', (chunk) => data += chunk)
            res.on('end', () => {
                try {
                    const results = parseBingHtml(data, maxResults)
                    if (results.length === 0) {
                        logger.ipc.warn('[HTTP] Bing returned 0 results, response length:', data.length)
                    }
                    resolve({ success: true, results })
                } catch (error) {
                    resolve({ success: false, error: `Failed to parse Bing response: ${error}` })
                }
            })
        })

        req.on('error', (error) => {
            resolve({ success: false, error: `Bing request failed: ${error.message}` })
        })

        req.setTimeout(timeout, () => {
            req.destroy()
            resolve({ success: false, error: 'Bing request timed out' })
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

// ===== 注册 IPC Handlers =====

export function registerHttpHandlers() {
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

    // 配置搜索引擎状态
    safeIpcHandle('http:setSearchEngineState', async (_event, state: SearchEngineState) => {
        setSearchEngineState(state)
        return { success: true }
    })

    logger.ipc.info('[HTTP] IPC handlers registered')
}



