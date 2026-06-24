/**
 * 代码补全服务适配器
 *
 * 提供代码补全的上下文构建、校验与补全请求能力。
 */

/* ------------------------------------------------------------------ */
/* 类型定义                                                            */
/* ------------------------------------------------------------------ */

/** 光标位置 */
export interface Position {
  line: number
  column: number
}

/** 补全上下文 */
export interface CompletionContext {
  /** 当前文件路径 */
  filePath: string
  /** 当前文件内容 */
  fileContent: string
  /** 光标位置 */
  cursorPosition: Position
  /** 光标前缀文本 */
  prefix: string
  /** 光标后缀文本 */
  suffix: string
  /** 文件语言 */
  language: string
  /** 已打开的文件列表 */
  openFiles: Array<{ path: string; content: string }>
}

/** 补全请求 */
export interface CompletionRequest {
  prompt: string
  maxTokens?: number
  temperature?: number
  stopSequences?: string[]
}

/** 补全响应 */
export interface CompletionResponse {
  text: string
  finishReason: string
  usage?: { promptTokens: number; completionTokens: number }
}

/* ------------------------------------------------------------------ */
/* 语言检测                                                            */
/* ------------------------------------------------------------------ */

/** 文件扩展名到语言名的映射 */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.vue': 'vue',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.cpp': 'cpp',
  '.c': 'c',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sql': 'sql',
}

/** 根据文件路径检测语言 */
function detectLanguage(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.')
  if (lastDot < 0) return 'plaintext'
  const ext = filePath.slice(lastDot).toLowerCase()
  return EXTENSION_LANGUAGE_MAP[ext] || 'plaintext'
}

/* ------------------------------------------------------------------ */
/* 补全服务                                                            */
/* ------------------------------------------------------------------ */

/**
 * 代码补全服务
 *
 * 负责构建补全上下文、校验上下文有效性，并调用 LLM 完成补全
 */
export class CompletionService {
  /**
   * 构建补全上下文
   *
   * @param filePath 当前文件路径
   * @param fileContent 当前文件内容
   * @param cursorPosition 光标位置
   * @param openFiles 已打开文件列表（可选，从 store 获取）
   */
  buildContext(
    filePath: string,
    fileContent: string,
    cursorPosition: Position,
    openFiles: Array<{ path: string; content: string }> = [],
  ): CompletionContext {
    const lines = fileContent.split('\n')
    const lineIndex = Math.min(cursorPosition.line, lines.length - 1)
    const currentLine = lines[lineIndex] || ''
    const column = Math.min(cursorPosition.column, currentLine.length)

    // 计算光标前后的文本
    const prefixLines = lines.slice(0, lineIndex)
    prefixLines.push(currentLine.slice(0, column))
    const prefix = prefixLines.join('\n')

    const suffixLines = lines.slice(lineIndex + 1)
    suffixLines.unshift(currentLine.slice(column))
    const suffix = suffixLines.join('\n')

    return {
      filePath,
      fileContent,
      cursorPosition: { line: lineIndex, column },
      prefix,
      suffix,
      language: detectLanguage(filePath),
      openFiles,
    }
  }

  /**
   * 校验补全上下文是否有效
   *
   * @param context 待校验的上下文
   * @returns 是否有效
   */
  validateContext(context: CompletionContext): boolean {
    if (!context) return false
    if (typeof context.filePath !== 'string' || context.filePath === '') return false
    if (typeof context.fileContent !== 'string') return false
    if (!context.cursorPosition) return false
    if (typeof context.cursorPosition.line !== 'number') return false
    if (typeof context.cursorPosition.column !== 'number') return false
    if (!Array.isArray(context.openFiles)) return false
    return true
  }

  /**
   * 执行补全请求
   *
   * @param request 补全请求
   * @returns 补全响应
   */
  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    return {
      text: '',
      finishReason: 'error',
      usage: { promptTokens: 0, completionTokens: 0 },
    }
  }
}

/** 全局补全服务实例 */
export const completionService = new CompletionService()
