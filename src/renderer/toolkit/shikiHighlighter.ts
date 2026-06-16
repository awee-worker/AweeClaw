/**
 * Shiki 代码高亮工具
 * 使用 VS Code 同款 TextMate 语法引擎，支持 200+ 语言，语法解析精度远超 Prism
 * 高亮器在模块加载时异步初始化，初始化完成后 codeToHtml 同步执行
 */
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { bundledThemes } from 'shiki/themes'

// 按需加载的语言包（仅加载常用语言，避免 bundle 体积过大）
import langsTypescript from 'shiki/langs/typescript.mjs'
import langsJavascript from 'shiki/langs/javascript.mjs'
import langsTsx from 'shiki/langs/tsx.mjs'
import langsJson from 'shiki/langs/json.mjs'
import langsBash from 'shiki/langs/bash.mjs'
import langsCss from 'shiki/langs/css.mjs'
import langsHtml from 'shiki/langs/html.mjs'
import langsPython from 'shiki/langs/python.mjs'
import langsMarkdown from 'shiki/langs/markdown.mjs'
import langsYaml from 'shiki/langs/yaml.mjs'
import langsRust from 'shiki/langs/rust.mjs'
import langsGo from 'shiki/langs/go.mjs'
import langsJava from 'shiki/langs/java.mjs'
import langsCsharp from 'shiki/langs/csharp.mjs'
import langsCpp from 'shiki/langs/cpp.mjs'
import langsSql from 'shiki/langs/sql.mjs'
import langsVue from 'shiki/langs/vue.mjs'
import langsShell from 'shiki/langs/shellscript.mjs'
import langsDiff from 'shiki/langs/diff.mjs'
import langsXml from 'shiki/langs/xml.mjs'
import langsToml from 'shiki/langs/toml.mjs'
import langsGraphql from 'shiki/langs/graphql.mjs'
import langsDockerfile from 'shiki/langs/dockerfile.mjs'
import langsIni from 'shiki/langs/ini.mjs'
import langsMakefile from 'shiki/langs/makefile.mjs'
import langsPhp from 'shiki/langs/php.mjs'
import langsRuby from 'shiki/langs/ruby.mjs'
import langsSwift from 'shiki/langs/swift.mjs'
import langsKotlin from 'shiki/langs/kotlin.mjs'
import langsScala from 'shiki/langs/scala.mjs'
import langsLatex from 'shiki/langs/latex.mjs'
import langsLua from 'shiki/langs/lua.mjs'
import langsPerl from 'shiki/langs/perl.mjs'
import langsR from 'shiki/langs/r.mjs'
import langsDart from 'shiki/langs/dart.mjs'
import langsElixir from 'shiki/langs/elixir.mjs'
import langsHaskell from 'shiki/langs/haskell.mjs'
import langsClojure from 'shiki/langs/clojure.mjs'
import langsErlang from 'shiki/langs/erlang.mjs'
import langsGroovy from 'shiki/langs/groovy.mjs'
import langsPowershell from 'shiki/langs/powershell.mjs'
import langsMatlab from 'shiki/langs/matlab.mjs'
import langsObjectiveC from 'shiki/langs/objective-c.mjs'
import langsSvelte from 'shiki/langs/svelte.mjs'
import langsLess from 'shiki/langs/less.mjs'
import langsScss from 'shiki/langs/scss.mjs'
import langsStylus from 'shiki/langs/stylus.mjs'
import langsNginx from 'shiki/langs/nginx.mjs'
import langsProtobuf from 'shiki/langs/protobuf.mjs'

import type { HighlighterCore } from 'shiki/core'

// ============================================================
// 语言别名映射（Prism → Shiki / 常用别名）
// ============================================================
const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'tsx',
  ts: 'typescript',
  tsx: 'tsx',
  sh: 'shellscript',
  zsh: 'shellscript',
  bash: 'bash',
  shell: 'shellscript',
  cmd: 'batch',
  bat: 'batch',
  py: 'python',
  rb: 'ruby',
  csharp: 'csharp',
  'c#': 'csharp',
  cpp: 'cpp',
  'c++': 'cpp',
  objectivec: 'objective-c',
  objc: 'objective-c',
  vue: 'vue',
  svelte: 'svelte',
  markdown: 'markdown',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  jsonc: 'jsonc',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  stylus: 'stylus',
  styl: 'stylus',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  sql: 'sql',
  toml: 'toml',
  ini: 'ini',
  xml: 'xml',
  svg: 'xml',
  diff: 'diff',
  makefile: 'makefile',
  mk: 'makefile',
  rust: 'rust',
  rs: 'rust',
  go: 'go',
  golang: 'go',
  java: 'java',
  kotlin: 'kotlin',
  kt: 'kotlin',
  swift: 'swift',
  scala: 'scala',
  dart: 'dart',
  lua: 'lua',
  perl: 'perl',
  pl: 'perl',
  r: 'r',
  php: 'php',
  ruby: 'ruby',
  elixir: 'elixir',
  ex: 'elixir',
  haskell: 'haskell',
  hs: 'haskell',
  clojure: 'clojure',
  clj: 'clojure',
  erlang: 'erlang',
  erl: 'erlang',
  groovy: 'groovy',
  powershell: 'powershell',
  ps1: 'powershell',
  matlab: 'matlab',
  latex: 'latex',
  tex: 'latex',
  nginx: 'nginx',
  protobuf: 'protobuf',
  proto: 'protobuf',
  plaintext: 'text',
  text: 'text',
  txt: 'text',
}

// ============================================================
// 高速缓存 - 避免重复转换相同代码
// ============================================================
const codeCache = new Map<string, string>()
const MAX_CACHE_SIZE = 200

// ============================================================
// 高亮器实例（懒加载单例）
// ============================================================
let highlighterInstance: HighlighterCore | null = null
let initPromise: Promise<HighlighterCore> | null = null
let initError: Error | null = null

const DARK_THEME = 'one-dark-pro'
const LIGHT_THEME = 'one-light'

const ALL_LANGS = [
  langsTypescript, langsJavascript, langsTsx, langsJson, langsBash,
  langsCss, langsHtml, langsPython, langsMarkdown, langsYaml, langsRust,
  langsGo, langsJava, langsCsharp, langsCpp, langsSql, langsVue, langsShell,
  langsDiff, langsXml, langsToml, langsGraphql, langsDockerfile, langsIni,
  langsMakefile, langsPhp, langsRuby, langsSwift, langsKotlin, langsScala,
  langsLatex, langsLua, langsPerl, langsR, langsDart, langsElixir,
  langsHaskell, langsClojure, langsErlang, langsGroovy, langsPowershell,
  langsMatlab, langsObjectiveC, langsSvelte, langsLess, langsScss,
  langsStylus, langsNginx, langsProtobuf,
]

/**
 * 初始化高亮器（异步，仅执行一次）
 */
async function initHighlighter(): Promise<HighlighterCore> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      const engine = createJavaScriptRegexEngine()
      const highlighter = await createHighlighterCore({
        themes: [bundledThemes[DARK_THEME], bundledThemes[LIGHT_THEME]],
        langs: ALL_LANGS,
        engine,
      })
      highlighterInstance = highlighter
      return highlighter
    } catch (err) {
      initError = err instanceof Error ? err : new Error(String(err))
      console.error('[Shiki] 初始化失败:', initError)
      throw initError
    }
  })()

  return initPromise
}

/**
 * 获取高亮器实例（同步，需先调用 initHighlighter 或 ensureReady）
 */
export function getHighlighter(): HighlighterCore | null {
  return highlighterInstance
}

/**
 * 确保高亮器已就绪，返回 Promise
 */
export function ensureReady(): Promise<HighlighterCore> {
  return initHighlighter()
}

/**
 * 高亮器是否已就绪
 */
export function isHighlighterReady(): boolean {
  return highlighterInstance !== null
}

/**
 * 规范化语言名称
 */
function normalizeLang(lang: string | undefined): string {
  if (!lang) return 'text'
  const lower = lang.toLowerCase().trim()
  return LANG_ALIASES[lower] || lower
}

/**
 * 构建缓存 key
 */
function cacheKey(code: string, lang: string, theme: string): string {
  return `${theme}:${lang}:${code.slice(0, 120)}`
}

/**
 * 代码高亮：返回 HTML 字符串
 * @param code 原始代码文本
 * @param language 语言标识（支持别名）
 * @param isDark 是否暗色主题
 * @returns 高亮后的 HTML 字符串，失败时返回纯文本版
 */
export function highlightCode(
  code: string,
  language?: string,
  isDark = true,
): string {
  const hl = highlighterInstance
  if (!hl) {
    // 高亮器未就绪，返回纯文本
    return escapeHtml(code)
  }

  const lang = normalizeLang(language)
  const theme = isDark ? DARK_THEME : LIGHT_THEME
  const key = cacheKey(code, lang, theme)

  const cached = codeCache.get(key)
  if (cached) return cached

  try {
    const html = hl.codeToHtml(code, { lang, theme })
    // 缓存管理
    if (codeCache.size >= MAX_CACHE_SIZE) {
      const firstKey = codeCache.keys().next().value
      if (firstKey !== undefined) codeCache.delete(firstKey)
    }
    codeCache.set(key, html)
    return html
  } catch {
    // 语言不支持时回退到纯文本
    return escapeHtml(code)
  }
}

/**
 * 清除缓存
 */
export function clearHighlightCache(): void {
  codeCache.clear()
}

/**
 * HTML 转义（纯文本兜底）
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 从 shiki 输出的完整 HTML 中提取 <code> 内部内容（用于行内展示）
 * shiki 输出: <pre class="shiki"...><code><span class="line">...</span></code></pre>
 * 提取后:     <span class="line">...</span>
 */
export function extractInlineHtml(html: string): string {
  const codeMatch = html.match(/<code[^>]*>([\s\S]*)<\/code>/)
  if (!codeMatch) return html
  // 移除 <code> 标签上的 class 但保留其内容
  return codeMatch[1]
}

// 模块加载时自动初始化
initHighlighter().catch(() => {
  // 初始化失败不阻塞，后续 highlightCode 会返回纯文本
})