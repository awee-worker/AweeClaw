/**
 * ToolDefinition 代码生成器
 *
 * 把可视化的工具定义数组（JSON）编译成 TypeScript 源代码，
 * 写入场景项目的 src/tools/index.ts 文件，供场景运行时使用。
 *
 * 生成格式与 examples/kb-qa.ts 中的 src/tools/index.ts 模板一致：
 *   - 顶部导入 ToolDefinition 类型
 *   - 每个工具一个具名导出常量（PascalCase + Tool 后缀）
 *   - 末尾导出 tools 数组聚合所有工具
 *
 * 仅生成「定义」部分；执行器（executor）需要用户在 src/tools/executors.ts 中手动实现。
 */
import type { ToolDefinition, ToolPropertySchema } from '@shared/protocols/modelProtocol'

// ==========================================
// 工具函数
// ==========================================

/** 把 name 转成 PascalCase（如 list_records → ListRecords） */
function toPascalCase(name: string): string {
  return name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('')
}

/** 缩进指定层级（每层 2 空格） */
function indent(level: number): string {
  return '  '.repeat(level)
}

// ==========================================
// Schema 序列化
// ==========================================

/**
 * 把 ToolPropertySchema 序列化为 TypeScript 字面量
 * 使用 JSON.stringify 保证类型正确，再用 prettier-like 格式化
 */
function serializeSchema(schema: ToolPropertySchema, level: number): string {
  const pad = indent(level)
  const innerPad = indent(level + 1)
  const lines: string[] = []
  lines.push(`{`)

  // type 字段（必填）
  lines.push(`${innerPad}type: ${JSON.stringify(schema.type)},`)

  // description 字段
  if (schema.description) {
    lines.push(`${innerPad}description: ${JSON.stringify(schema.description)},`)
  }

  // enum 字段
  if (schema.enum && schema.enum.length > 0) {
    lines.push(`${innerPad}enum: ${JSON.stringify(schema.enum)},`)
  }

  // items 字段（数组类型）
  if (schema.items) {
    lines.push(`${innerPad}items: ${serializeSchema(schema.items, level + 1)},`)
  }

  // properties 字段（对象类型）
  if (schema.properties) {
    const propKeys = Object.keys(schema.properties)
    if (propKeys.length > 0) {
      lines.push(`${innerPad}properties: {`)
      for (const key of propKeys) {
        const propSchema = schema.properties[key]
        lines.push(`${innerPad}${key}: ${serializeSchema(propSchema, level + 2)},`)
      }
      lines.push(`${innerPad}},`)
    }
  }

  // required 字段
  if (schema.required && schema.required.length > 0) {
    lines.push(`${innerPad}required: ${JSON.stringify(schema.required)},`)
  }

  lines.push(`${pad}}`)
  return lines.join('\n')
}

/** 序列化整个 ToolDefinition */
function serializeToolDefinition(tool: ToolDefinition, level: number): string {
  const pad = indent(level)
  const innerPad = indent(level + 1)
  const lines: string[] = []
  lines.push(`{`)

  // name
  lines.push(`${innerPad}name: ${JSON.stringify(tool.name)},`)

  // description
  lines.push(`${innerPad}description: ${JSON.stringify(tool.description)},`)

  // approvalType（可选）
  if (tool.approvalType && tool.approvalType !== 'none') {
    lines.push(`${innerPad}approvalType: ${JSON.stringify(tool.approvalType)},`)
  }

  // parameters
  lines.push(`${innerPad}parameters: {`)
  lines.push(`${indent(level + 2)}type: 'object',`)

  // properties
  const propKeys = Object.keys(tool.parameters.properties || {})
  if (propKeys.length > 0) {
    lines.push(`${indent(level + 2)}properties: {`)
    for (const key of propKeys) {
      const propSchema = tool.parameters.properties[key]
      lines.push(
        `${indent(level + 3)}${key}: ${serializeSchema(propSchema, level + 3)},`,
      )
    }
    lines.push(`${indent(level + 2)}},`)
  } else {
    lines.push(`${indent(level + 2)}properties: {},`)
  }

  // required
  if (tool.parameters.required && tool.parameters.required.length > 0) {
    lines.push(
      `${indent(level + 2)}required: ${JSON.stringify(tool.parameters.required)},`,
    )
  }

  lines.push(`${innerPad}},`)
  lines.push(`${pad}}`)
  return lines.join('\n')
}

// ==========================================
// 主入口
// ==========================================

/**
 * 把工具定义数组编译成 TypeScript 源代码
 * @param tools 工具定义数组
 * @returns TypeScript 源代码字符串
 */
export function generateToolsTsCode(tools: ToolDefinition[]): string {
  const header = `/**
 * 工具定义（由 scenario-builder 可视化编辑器自动生成）
 *
 * 本文件由 src/tools/tools.json 编译生成，请勿手动修改。
 * 如需调整工具定义，请在 scenario-builder 的「工具」面板中编辑，
 * 然后点击「生成 TS 代码」按钮重新生成本文件。
 *
 * 执行器（executor）请在 src/tools/executors.ts 中实现。
 */
import type { ToolDefinition } from '@aweeclaw/scenario-sdk'

`

  // 空数组
  if (tools.length === 0) {
    return (
      header +
      `// 暂无工具定义
export const tools: ToolDefinition[] = []

export default tools
`
    )
  }

  // 每个工具一个具名导出
  const namedExports: string[] = []
  for (const tool of tools) {
    const pascalName = toPascalCase(tool.name) + 'Tool'
    namedExports.push(
      `export const ${pascalName}: ToolDefinition = ${serializeToolDefinition(
        tool,
        0,
      )}\n`,
    )
  }

  // 聚合数组
  const aggregateNames = tools
    .map((t) => toPascalCase(t.name) + 'Tool')
    .join(', ')
  const aggregate = `export const tools: ToolDefinition[] = [
  ${aggregateNames},
]

export default tools
`

  return header + namedExports.join('\n') + '\n' + aggregate + '\n'
}

/**
 * 从 src/tools/index.ts 源码反向解析工具定义（best-effort）
 *
 * 实现思路：
 * 1. 用正则提取每个 `export const XxxTool: ToolDefinition = {...}` 块
 * 2. 用 JSON.parse 解析（需将 JS 字面量转为 JSON）
 *
 * 注意：这是 best-effort 实现，对于复杂嵌套或非标准格式可能失败。
 * 失败时返回空数组，让用户从空开始编辑。
 *
 * @param sourceCode TypeScript 源代码
 * @returns 解析出的工具定义数组
 */
export function parseToolsFromTsCode(sourceCode: string): ToolDefinition[] {
  const tools: ToolDefinition[] = []

  // 匹配 `export const XxxTool: ToolDefinition = { ... }` 块
  // 使用非贪婪匹配 + 嵌套大括号计数（简化版：匹配到 `}\n` 结尾）
  const regex = /export\s+const\s+\w+Tool:\s*ToolDefinition\s*=\s*(\{[\s\S]*?\n\})\s*\n/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(sourceCode)) !== null) {
    const literal = match[1]
    try {
      // 尝试把 JS 字面量转为 JSON
      // 1. 移除行尾逗号
      const jsonish = literal
        .replace(/,(\s*\n\s*\})/g, '$1') // 移除对象结尾逗号
        .replace(/,(\s*\n\s*\])/g, '$1') // 移除数组结尾逗号
        // 2. 给未加引号的属性名加引号
        .replace(/(\{|,)\s*(\w+)\s*:/g, '$1 "$2":')

      const parsed = JSON.parse(jsonish) as ToolDefinition
      if (parsed.name && parsed.description) {
        tools.push(parsed)
      }
    } catch {
      // 解析失败，跳过该工具
      continue
    }
  }

  return tools
}
