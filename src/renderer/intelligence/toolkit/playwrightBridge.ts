/**
 * Playwright MCP JS 执行容错桥接器
 *
 * 为 Playwright 的 browser_run_code_unsafe 等工具提供 JS 代码预处理：
 * 1. 清理 Markdown 代码块包装
 * 2. 自动包装裸函数体（AI 常输出 return document.title 而非完整函数）
 * 3. 导航安全拦截（submit/location 操作延迟执行）
 */

// ==================== 类型 ====================

export interface JsExecutionOptions {
  /** 是否启用导航安全拦截，默认 true */
  safeNavigation?: boolean
  /** 导航操作延迟执行毫秒数，默认 100 */
  navDelayMs?: number
  /** 是否在结果中附加处理痕迹（调试用） */
  debug?: boolean
}

export interface JsExecutionResult {
  /** 处理后的 JS 代码 */
  code: string
  /** 原始代码 */
  originalCode: string
  /** 是否进行了包装转换 */
  wasWrapped: boolean
  /** 是否检测到导航操作 */
  hasNavigation: boolean
  /** 是否被调度为异步执行 */
  scheduledAsync?: boolean
  /** 调试信息 */
  debug?: string
}

// ==================== 导航安全关键词 ====================

const NAVIGATION_KEYWORDS = [
  'submit()',
  'location.href',
  'location.assign',
  'location.replace',
  'window.open',
  'document.location',
  'history.push',
  'history.replace',
  'window.location',
] as const

// ==================== 核心函数 ====================

/**
 * 清理 Markdown 代码块包装
 *
 * 输入:
 *   ```javascript
 *   return document.title
 *   ```
 * 输出:
 *   return document.title
 */
export function cleanMarkdownWrapping(code: string): string {
  let clean = code.trim()
  // 移除开始标记：```javascript、```js、```
  clean = clean.replace(/^```(?:javascript|js)?\s*\n?/i, '')
  // 移除结束标记：```
  clean = clean.replace(/\n?\s*```\s*$/, '')
  return clean.trim()
}

/**
 * 检测代码是否为裸函数体（需要包装）
 *
 * 常见 AI 输出模式：
 *   return document.title
 *   page.url()
 *   document.querySelector('.btn').textContent
 */
function isLikelyFunctionBody(code: string): boolean {
  const trimmed = code.trim()

  // 已经是完整语句或函数声明，不需要包装
  if (
    trimmed.startsWith('function') ||
    trimmed.startsWith('async ') ||
    trimmed.startsWith('const ') ||
    trimmed.startsWith('let ') ||
    trimmed.startsWith('var ') ||
    trimmed.startsWith('return ') === false && trimmed.includes('(')
  ) {
    return false
  }

  // 以 return 开头且非空对象
  if (trimmed.startsWith('return ')) {
    return true
  }

  // 包含箭头函数特征
  if (trimmed.includes('=>')) {
    return true
  }

  // 单行表达式（无分号结尾，非声明）
  const hasSemicolon = trimmed.endsWith(';')
  const lines = trimmed.split('\n').filter(l => l.trim())
  if (lines.length <= 3 && !hasSemicolon) {
    return true
  }

  return false
}

/**
 * 自动包装裸函数体为完整函数
 *
 * 输入:  return document.title
 * 输出:  function() { return document.title }
 */
export function autoWrapJS(code: string): string {
  const cleaned = cleanMarkdownWrapping(code)
  if (isLikelyFunctionBody(cleaned)) {
    return `function() { ${cleaned} }`
  }
  return cleaned
}

/**
 * 检测并拦截导航操作，改为异步延迟执行
 *
 * 避免页面跳转导致 Playwright 连接异常
 */
export function safeExecuteJS(
  code: string,
  options: JsExecutionOptions = {},
): JsExecutionResult {
  const {
    safeNavigation = true,
    navDelayMs = 100,
    debug = false,
  } = options

  const originalCode = code
  const cleaned = cleanMarkdownWrapping(code)
  let processedCode = cleaned
  let wasWrapped = false
  let hasNavigation = false
  let scheduledAsync = false
  const debugNotes: string[] = []

  // Step 1: 自动包装裸函数体
  if (isLikelyFunctionBody(processedCode)) {
    processedCode = `function() { ${processedCode} }`
    wasWrapped = true
    debugNotes.push('wrapped function body')
  }

  // Step 2: 导航安全拦截
  if (safeNavigation) {
    const navMatch = NAVIGATION_KEYWORDS.some(
      (kw) => processedCode.includes(kw),
    )
    if (navMatch) {
      hasNavigation = true
      const asyncWrapper = `setTimeout(() => { ${processedCode} }, ${navDelayMs}); 'Navigation command scheduled for async execution';`
      processedCode = asyncWrapper
      scheduledAsync = true
      debugNotes.push(`navigation intercepted → async delay ${navDelayMs}ms`)
    }
  }

  // Step 3: 清理多余的分号（包装后可能重复）
  processedCode = processedCode.replace(/;\s*}\s*;?\s*$/, ' }')

  return {
    code: processedCode,
    originalCode,
    wasWrapped,
    hasNavigation,
    scheduledAsync,
    debug: debug ? debugNotes.join('; ') : undefined,
  }
}

/**
 * 对 Playwright MCP 工具的 code 参数进行预处理
 *
 * 用于 browser_run_code_unsafe 等工具的调用前处理
 */
export function prepareJsForPlaywright(
  code: string,
  options: JsExecutionOptions = {},
): string {
  const result = safeExecuteJS(code, options)
  return result.code
}

/**
 * 批量处理多条 JS 代码（用于重试逻辑）
 */
export function prepareJsBatch(
  codes: string[],
  options: JsExecutionOptions = {},
): JsExecutionResult[] {
  return codes.map((code) => safeExecuteJS(code, options))
}

// ==================== 导出默认 ====================

export default {
  cleanMarkdownWrapping,
  autoWrapJS,
  safeExecuteJS,
  prepareJsForPlaywright,
  prepareJsBatch,
}
