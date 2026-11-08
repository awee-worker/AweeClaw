/**
 * Shell 命令结构化解析 — shared 单一来源
 *
 * 职责：
 * - 把一条复合命令拆成可执行段（`;` `&&` `||` `|` 换行），并提取每段的命令名
 * - 提取命令替换体（`$(...)` / 反引号），支持嵌套
 *
 * 解决什么问题：
 *   命令安全校验如果只看「第一个词」，`echo ok; rm -rf ~/data` 与 `r=$(rm -rf ~)`
 *   都能绕过去；反过来，对 `$(` 做子串拦截又会把 `r=$(lsof -i:8080)` 这类日常写法
 *   整条拒掉。两处的根因相同：没有按 shell 语义拆解命令。本模块只负责解析，
 *   判定策略仍留在调用方（沙箱黑名单 / 终端黑名单 / 危险模式正则）。
 *
 * 引号语义按 POSIX shell：
 * - 单引号内不展开替换，也不参与分段的字符判定
 * - 双引号内替换照常展开
 * - Windows 默认 shell 是 PowerShell，反引号是转义符（"a`nb"），不作为替换解析
 */

/** 命令替换在分段文本中的占位符：仅用于切词定位命令名，不会出现在真实命令里 */
export const SUBSTITUTION_PLACEHOLDER = '__AWEECLAW_SUBSTITUTION__'

/** 反引号是否按命令替换处理（POSIX shell 是，PowerShell 不是） */
export function treatsBacktickAsSubstitution(): boolean {
  return typeof process !== 'undefined' && process.platform !== 'win32'
}

/** 替换体嵌套解析的最大深度，超出后不再深入（避免恶意构造的长嵌套拖住校验） */
const MAX_SUBSTITUTION_DEPTH = 4

/**
 * 从 `(` 的位置起做括号配平，返回匹配的 `)` 下标；未闭合返回 -1
 */
function findMatchingParen(command: string, openIndex: number): number {
  let depth = 0
  let inSingle = false
  let inDouble = false

  for (let i = openIndex; i < command.length; i++) {
    const ch = command[i]
    if (ch === '\\' && !inSingle) {
      i++
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (inSingle || inDouble) continue

    if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }

  return -1
}

/**
 * 找到替换体结束的反引号下标（跳过转义反引号）；未闭合返回 -1
 */
function findClosingBacktick(command: string, from: number): number {
  for (let i = from; i < command.length; i++) {
    if (command[i] === '\\') {
      i++
      continue
    }
    if (command[i] === '`') return i
  }
  return -1
}

/**
 * 提取命令中的命令替换体（`$(...)` 与反引号），包含嵌套层级
 *
 * 嵌套的 `$(...)` 会先作为外层替换体的一部分返回，其内部结构再递归展开，
 * 调用方拿到的是一组「待校验文本」，逐条过黑名单与危险模式即可。
 */
export function extractSubstitutions(command: string, depth = 0): string[] {
  if (depth > MAX_SUBSTITUTION_DEPTH) return []

  const backtick = treatsBacktickAsSubstitution()
  const found: string[] = []
  let i = 0
  let inSingle = false
  let inDouble = false

  while (i < command.length) {
    const ch = command[i]

    if (ch === '\\' && !inSingle) {
      i += 2
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      i++
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      i++
      continue
    }
    if (inSingle) {
      i++
      continue
    }

    if (ch === '$' && command[i + 1] === '(') {
      const end = findMatchingParen(command, i + 1)
      if (end < 0) {
        i++
        continue
      }
      const inner = command.slice(i + 2, end)
      found.push(inner)
      // 嵌套替换一并展开，调用方拿到的是全部层级的替换体
      found.push(...extractSubstitutions(inner, depth + 1))
      i = end + 1
      continue
    }

    if (ch === '`' && backtick) {
      const end = findClosingBacktick(command, i + 1)
      if (end < 0) {
        i++
        continue
      }
      const inner = command.slice(i + 1, end)
      found.push(inner)
      found.push(...extractSubstitutions(inner, depth + 1))
      i = end + 1
      continue
    }

    i++
  }

  return found
}

/**
 * 按 `;` `&&` `||` `|` 换行拆出各执行段（引号感知）
 *
 * 命令替换整体折叠成占位符，其内部内容由 extractSubstitutions 单独处理，
 * 避免替换体里的分隔符把外层段拆碎。
 */
export function splitCommandSegments(command: string): string[] {
  const backtick = treatsBacktickAsSubstitution()
  const segments: string[] = []
  let current = ''
  let i = 0
  let inSingle = false
  let inDouble = false

  const flush = (): void => {
    if (current.trim()) segments.push(current)
    current = ''
  }

  while (i < command.length) {
    const ch = command[i]

    if (ch === '\\' && !inSingle) {
      current += command.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      current += ch
      i++
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      current += ch
      i++
      continue
    }

    if (inSingle || inDouble) {
      // 双引号内允许命令替换展开，折叠成占位符
      if (inDouble && ch === '$' && command[i + 1] === '(') {
        const end = findMatchingParen(command, i + 1)
        if (end > 0) {
          current += SUBSTITUTION_PLACEHOLDER
          i = end + 1
          continue
        }
      }
      if (inDouble && ch === '`' && backtick) {
        const end = findClosingBacktick(command, i + 1)
        if (end > 0) {
          current += SUBSTITUTION_PLACEHOLDER
          i = end + 1
          continue
        }
      }
      current += ch
      i++
      continue
    }

    // 引号外：命令替换同样折叠为占位符
    if (ch === '$' && command[i + 1] === '(') {
      const end = findMatchingParen(command, i + 1)
      if (end > 0) {
        current += SUBSTITUTION_PLACEHOLDER
        i = end + 1
        continue
      }
    }
    if (ch === '`' && backtick) {
      const end = findClosingBacktick(command, i + 1)
      if (end > 0) {
        current += SUBSTITUTION_PLACEHOLDER
        i = end + 1
        continue
      }
    }

    if (ch === ';' || ch === '|' || ch === '\n') {
      flush()
      i += ch === '|' && command[i + 1] === '|' ? 2 : 1
      continue
    }
    if (ch === '&' && command[i + 1] === '&') {
      flush()
      i += 2
      continue
    }

    current += ch
    i++
  }

  flush()
  return segments
}

/**
 * 从单个执行段提取命令名（去掉 `VAR=value` 环境变量前缀与路径）
 *
 * `FOO=bar npm test` → `npm`；整段只有赋值（`r=$(...)`）时返回空串
 */
export function extractSegmentCommandName(segment: string): string {
  const tokens = segment.trim().split(/\s+/)

  for (const token of tokens) {
    if (!token) continue
    // 跳过 VAR=value 形式的环境变量前缀与占位符
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue
    if (token === SUBSTITUTION_PLACEHOLDER) continue
    // 以 - 开头的是选项，不是命令名（`r=$(lsof -i:8080)` 这类未折叠输入也不会取到参数）
    if (token.startsWith('-')) continue

    const bare = token.replace(/^['"]+|['"]+$/g, '')
    if (!bare) continue
    return bare.includes('/') || bare.includes('\\')
      ? bare.slice(Math.max(bare.lastIndexOf('/'), bare.lastIndexOf('\\')) + 1)
      : bare
  }

  return ''
}

/**
 * 收集一条命令里出现在「可执行位置」的全部命令名：各执行段 + 各层替换体内部
 *
 * 调用方拿到的顺序是「先顶层段，后替换体」，命中即拒绝时可直接用首个匹配项报错。
 */
export function collectCommandNames(command: string, depth = 0): string[] {
  if (depth > MAX_SUBSTITUTION_DEPTH) return []

  const names: string[] = []
  for (const segment of splitCommandSegments(command)) {
    const name = extractSegmentCommandName(segment)
    if (name) names.push(name)
  }
  for (const inner of extractSubstitutions(command)) {
    names.push(...collectCommandNames(inner, depth + 1))
  }
  return names
}
