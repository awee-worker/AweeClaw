/**
 * AST 分析器 — 基于 Tree-sitter 的调用图提取
 *
 * 通过组合多个专职组件实现源码符号提取：
 * - 捕获名称解析器：从 Tree-sitter 捕获中解析定义与调用的名称
 * - 作用域追踪器：追踪当前所在的函数定义作用域
 * - 调用图提取器：遍历捕获结果，构建定义节点与调用节点
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as path from 'path'
import * as fs from 'fs'
import Parser from 'web-tree-sitter'
import type { CodeGraphNode } from '@protocols'

export type { CodeGraphNode }

/* ------------------------------------------------------------------ */
/* 调用图查询语句                                                     */
/* ------------------------------------------------------------------ */

/** 各语言的调用图查询语句：捕获函数定义与函数调用 */
const CALL_GRAPH_QUERIES: Readonly<Record<string, string>> = Object.freeze({
  typescript: [
    '(function_declaration name: (identifier) @def.name) @def',
    '(method_definition name: (property_identifier) @def.name) @def',
    '(variable_declarator name: (identifier) @def.name value: [(arrow_function) (function_expression)]) @def',
    '(call_expression function: [(identifier) (member_expression property: (property_identifier))] @call.name) @call',
  ].join('\n'),

  tsx: [
    '(function_declaration name: (identifier) @def.name) @def',
    '(method_definition name: (property_identifier) @def.name) @def',
    '(variable_declarator name: (identifier) @def.name value: [(arrow_function) (function_expression)]) @def',
    '(call_expression function: [(identifier) (member_expression property: (property_identifier))] @call.name) @call',
  ].join('\n'),

  javascript: [
    '(function_declaration name: (identifier) @def.name) @def',
    '(method_definition name: (property_identifier) @def.name) @def',
    '(variable_declarator name: (identifier) @def.name value: [(arrow_function) (function_expression)]) @def',
    '(call_expression function: [(identifier) (member_expression property: (property_identifier))] @call.name) @call',
  ].join('\n'),

  python: [
    '(function_definition name: (identifier) @def.name) @def',
    '(call function: [(identifier) (attribute attribute: (identifier))] @call.name) @call',
  ].join('\n'),
})

/** 文件扩展名到 Tree-sitter 语言名的映射 */
const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, string>> = Object.freeze({
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyw: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  cs: 'c_sharp',
  rb: 'ruby',
  php: 'php',
})

/* ------------------------------------------------------------------ */
/* 捕获名称解析器                                                     */
/* ------------------------------------------------------------------ */

/** 从 Tree-sitter 捕获列表中解析定义与调用的名称节点 */
class CaptureNameResolver {
  /**
   * 查找与定义节点关联的名称节点
   *
   * @param captures 所有捕获列表
   * @param defNode 定义节点
   * @returns 名称节点的文本，未找到时返回 'anonymous'
   */
  resolveDefName(
    captures: Parser.QueryCapture[],
    defNode: Parser.SyntaxNode,
  ): string {
    const nameCapture = captures.find(
      (c) =>
        c.name === 'def.name' &&
        (c.node.parent?.id === defNode.id || c.node.parent?.parent?.id === defNode.id),
    )
    return nameCapture ? nameCapture.node.text : 'anonymous'
  }

  /**
   * 查找与调用节点关联的名称节点
   *
   * @param captures 所有捕获列表
   * @param callNode 调用节点
   * @returns 名称节点；未找到时返回 null
   */
  resolveCallName(
    captures: Parser.QueryCapture[],
    callNode: Parser.SyntaxNode,
  ): Parser.SyntaxNode | null {
    const nameCapture = captures.find(
      (c) => c.name === 'call.name' && c.node.parent?.id === callNode.id,
    )
    return nameCapture ? nameCapture.node : null
  }

  /**
   * 从名称节点提取被调用的函数名
   * 对于成员表达式（如 obj.method），提取属性部分
   *
   * @param nameNode 名称节点
   * @returns 被调用的函数名
   */
  extractCalleeName(nameNode: Parser.SyntaxNode): string {
    if (nameNode.type === 'member_expression') {
      const prop = nameNode.childForFieldName('property')
      if (prop) return prop.text
    }
    return nameNode.text
  }
}

/* ------------------------------------------------------------------ */
/* 作用域追踪器                                                       */
/* ------------------------------------------------------------------ */

/** 定义作用域记录 */
interface ScopeEntry {
  /** 函数名 */
  name: string
  /** 函数结束行号 */
  endRow: number
}

/** 追踪当前所在的函数定义作用域 */
class ScopeTracker {
  private readonly stack: ScopeEntry[] = []

  /**
   * 根据当前行号弹出已离开的作用域
   *
   * @param currentRow 当前行号
   */
  popExited(currentRow: number): void {
    while (
      this.stack.length > 0 &&
      currentRow > this.stack[this.stack.length - 1].endRow
    ) {
      this.stack.pop()
    }
  }

  /** 压入新的定义作用域 */
  push(name: string, endRow: number): void {
    this.stack.push({ name, endRow })
  }

  /** 获取当前所在作用域的函数名 */
  currentScopeName(): string {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1].name : 'global'
  }

  /** 清空作用域栈 */
  clear(): void {
    this.stack.length = 0
  }
}

/* ------------------------------------------------------------------ */
/* 调用图提取器                                                       */
/* ------------------------------------------------------------------ */

/** 遍历 Tree-sitter 捕获结果，构建调用图节点 */
class CallGraphExtractor {
  private readonly nameResolver = new CaptureNameResolver()
  private readonly scopeTracker = new ScopeTracker()

  /**
   * 从捕获列表中提取调用图节点
   *
   * @param captures Tree-sitter 查询捕获列表
   * @returns 调用图节点列表
   */
  extract(captures: Parser.QueryCapture[]): CodeGraphNode[] {
    const nodes: CodeGraphNode[] = []
    this.scopeTracker.clear()

    for (const capture of captures) {
      const { node, name } = capture
      this.scopeTracker.popExited(node.startPosition.row)

      if (name === 'def') {
        const defName = this.nameResolver.resolveDefName(captures, node)
        nodes.push(this.createDefinitionNode(node, defName))
        this.scopeTracker.push(defName, node.endPosition.row)
      } else if (name === 'call') {
        const callNode = this.createCallNode(captures, node)
        if (callNode) nodes.push(callNode)
      }
    }

    return nodes
  }

  /** 创建函数定义节点 */
  private createDefinitionNode(node: Parser.SyntaxNode, defName: string): CodeGraphNode {
    return {
      id: `def_${node.startPosition.row}_${defName}`,
      name: defName,
      type: 'definition',
      content: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    }
  }

  /** 创建函数调用节点 */
  private createCallNode(
    captures: Parser.QueryCapture[],
    node: Parser.SyntaxNode,
  ): CodeGraphNode | null {
    const nameNode = this.nameResolver.resolveCallName(captures, node)
    if (!nameNode) return null

    const calleeName = this.nameResolver.extractCalleeName(nameNode)
    const callerName = this.scopeTracker.currentScopeName()

    return {
      id: `call_${node.startPosition.row}_${calleeName}`,
      name: calleeName,
      type: 'call',
      content: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      callerName,
      calleeName,
    }
  }
}

/* ------------------------------------------------------------------ */
/* WASM 路径解析器                                                    */
/* ------------------------------------------------------------------ */

/** 解析 Tree-sitter WASM 文件所在目录 */
class WasmPathResolver {
  /**
   * 查找 Tree-sitter WASM 目录
   *
   * @returns WASM 目录路径
   */
  resolve(): string {
    const candidates = [
      path.join(process.resourcesPath || '', 'tree-sitter'),
      path.join(process.cwd(), 'resources', 'tree-sitter'),
      path.join(__dirname, '..', '..', '..', 'resources', 'tree-sitter'),
    ]
    return candidates.find((p) => fs.existsSync(p)) || candidates[1]
  }
}

/* ------------------------------------------------------------------ */
/* AST 解析器（外观）                                                 */
/* ------------------------------------------------------------------ */

/** AST 解析器 — 协调 Tree-sitter 初始化、语言加载与调用图提取 */
export class ASTParser {
  private parser: Parser | null = null
  private readonly languages = new Map<string, Parser.Language>()
  private initialized = false
  private readonly wasmDir: string
  private readonly extractor = new CallGraphExtractor()

  constructor() {
    this.wasmDir = new WasmPathResolver().resolve()
  }

  /** 初始化 Tree-sitter 解析器 */
  async init(): Promise<void> {
    if (this.initialized) return
    try {
      const parserWasm = path.join(this.wasmDir, 'tree-sitter.wasm')
      await Parser.init({ locateFile: () => parserWasm })
      this.parser = new Parser()
      this.initialized = true
    } catch (e) {
      logger.index.error('[ASTParser] 初始化解析器失败:', e)
    }
  }

  /**
   * 解析文件的调用图
   *
   * @param filePath 文件路径
   * @param content 文件内容
   * @returns 调用图节点列表
   */
  async parseCallGraph(filePath: string, content: string): Promise<CodeGraphNode[]> {
    if (!this.initialized) await this.init()
    if (!this.parser) return []

    const ext = path.extname(filePath).slice(1).toLowerCase()
    const langName = EXTENSION_LANGUAGE_MAP[ext]
    if (!langName) return []

    const loaded = await this.loadLanguage(langName)
    if (!loaded) return []

    const lang = this.languages.get(langName)!
    this.parser.setLanguage(lang)
    const tree = this.parser.parse(content)
    if (!tree) return []

    const queryStr = CALL_GRAPH_QUERIES[langName]
    if (!queryStr) {
      tree.delete()
      return []
    }

    try {
      const query = lang.query(queryStr)
      const captures = query.captures(tree.rootNode)
      return this.extractor.extract(captures)
    } catch (e) {
      logger.index.error(`[ASTParser] 查询 ${filePath} 失败:`, e)
      return []
    } finally {
      tree.delete()
    }
  }

  /** 加载指定语言的 WASM */
  private async loadLanguage(langName: string): Promise<boolean> {
    if (!this.parser) return false
    if (this.languages.has(langName)) return true

    try {
      const wasmPath = path.join(this.wasmDir, `tree-sitter-${langName}.wasm`)
      const lang = await Parser.Language.load(wasmPath)
      this.languages.set(langName, lang)
      return true
    } catch (e) {
      logger.index.error(`[ASTParser] 加载语言 ${langName} 失败:`, e)
      return false
    }
  }
}
