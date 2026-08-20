/**
 * 工具 CRUD 代码片段集合
 *
 * 提供场景开发中常见的工具定义（Definition）+ 执行器（Executor）样板：
 *  - tool-definition:  单个工具的定义骨架
 *  - tool-executor:    单个工具的执行器骨架
 *  - tool-crud-set:    一组完整的 CRUD 工具（list/get/create/update/delete）
 */
import type { Snippet } from './types'

// 注意：code 字段中的 ${var} 是片段占位符，运行时由 SnippetService 替换。
// 由于 TS 模板字符串会把 ${} 当作插值求值，源码中使用 \${} 转义为字面字符串。

// ==========================================
// 工具定义骨架
// ==========================================
export const toolDefinitionSnippet: Snippet = {
  id: 'tool-definition',
  name: 'Tool Definition',
  nameZh: '工具定义骨架',
  description: 'Minimal tool definition with parameters schema and required fields',
  descriptionZh: '包含参数 schema 与必填字段的工具定义骨架',
  category: 'tool',
  applicableTypes: ['both'],
  language: 'typescript',
  icon: 'Wrench',
  tags: ['tool', 'definition', 'scaffold'],
  difficulty: 'beginner',
  targetFile: 'src/tools/index.ts',
  variables: [
    {
      name: 'toolName',
      defaultValue: 'my_tool',
      description: 'Tool name in snake_case',
      descriptionZh: '工具名称（snake_case）',
      required: true,
    },
    {
      name: 'toolDescription',
      defaultValue: 'Describe what this tool does',
      description: 'Human-readable description',
      descriptionZh: '工具描述',
      required: true,
    },
  ],
  code: `import type { ToolDefinition } from '@aweeclaw/scenario-sdk'

export const \${toolNamePascal}Tool: ToolDefinition = {
  name: '\${toolName}',
  description: '\${toolDescription}',
  parameters: {
    type: 'object',
    properties: {
      // TODO: 定义参数
      input: { type: 'string', description: 'Input value' },
    },
    required: ['input'],
  },
}`,
  usage: '将本片段插入到 src/tools/index.ts，修改参数 schema 后实现对应执行器。',
}

// ==========================================
// 工具执行器骨架
// ==========================================
export const toolExecutorSnippet: Snippet = {
  id: 'tool-executor',
  name: 'Tool Executor',
  nameZh: '工具执行器骨架',
  description: 'Tool executor skeleton with parameter extraction, validation, and structured result',
  descriptionZh: '工具执行器骨架：参数提取、校验、结构化结果返回',
  category: 'tool',
  applicableTypes: ['both'],
  language: 'typescript',
  icon: 'Play',
  tags: ['tool', 'executor', 'async'],
  difficulty: 'beginner',
  targetFile: 'src/tools/executors.ts',
  variables: [
    {
      name: 'toolName',
      defaultValue: 'my_tool',
      description: 'Tool name (matching the definition)',
      descriptionZh: '工具名（与定义一致）',
      required: true,
    },
    {
      name: 'toolNamePascal',
      defaultValue: 'MyTool',
      description: 'PascalCase version of tool name',
      descriptionZh: '工具名的 PascalCase 形式',
      required: true,
    },
  ],
  code: `import type { ToolExecutor } from '@shared/protocols/modelGateway'

export const \${toolNamePascal}Executor: ToolExecutor = async (args, context) => {
  // 1. 参数提取
  const input = args.input as string
  const limit = (args.limit as number) ?? 10

  // 2. 参数校验
  if (!input?.trim()) {
    return { success: false, result: '', error: 'input 不能为空' }
  }
  if (limit < 1 || limit > 100) {
    return { success: false, result: '', error: 'limit 必须在 1-100 之间' }
  }

  // 3. 业务逻辑
  try {
    context.getLogger().info('[\${toolName}] input=' + input + ', limit=' + limit)

    // TODO: 实现具体业务逻辑
    const data = { input, limit, processedAt: new Date().toISOString() }

    // 4. 返回结构化结果
    return {
      success: true,
      result: JSON.stringify({
        data,
        message: '\${toolName} 执行成功',
      }),
    }
  } catch (err) {
    context.getLogger().error('[\${toolName}] failed:', err)
    return {
      success: false,
      result: '',
      error: (err as Error).message,
    }
  }
}`,
  usage: '插入到 src/tools/executors.ts；记得在 tools/index.ts 的 EXECUTOR_MAP 中注册映射。',
}

// ==========================================
// 一组完整 CRUD 工具
// ==========================================
export const toolCrudSetSnippet: Snippet = {
  id: 'tool-crud-set',
  name: 'CRUD Tool Set',
  nameZh: 'CRUD 工具集',
  description: 'A complete set of CRUD tools (list/get/create/update/delete) for a single table',
  descriptionZh: '针对单表的完整 CRUD 工具集（list/get/create/update/delete）',
  category: 'tool',
  applicableTypes: ['both'],
  language: 'typescript',
  icon: 'Database',
  tags: ['tool', 'crud', 'database', 'scaffold'],
  difficulty: 'intermediate',
  targetFile: 'src/tools/index.ts',
  variables: [
    {
      name: 'tableName',
      defaultValue: 'records',
      description: 'Target table name',
      descriptionZh: '目标表名',
      required: true,
    },
    {
      name: 'entityName',
      defaultValue: 'record',
      description: 'Entity name in singular form',
      descriptionZh: '实体名单数形式',
      required: true,
    },
    {
      name: 'entityNamePascal',
      defaultValue: 'Record',
      description: 'Entity name in PascalCase',
      descriptionZh: '实体名 PascalCase 形式',
      required: true,
    },
  ],
  code: `import type { ToolDefinition } from '@aweeclaw/scenario-sdk'

/**
 * \${entityNamePascal} 表 CRUD 工具集
 * 表：\${tableName}
 */

// 列表查询
export const list\${entityNamePascal}Tool: ToolDefinition = {
  name: 'list_\${entityName}',
  description: 'List \${tableName} with optional keyword and pagination',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'Search keyword' },
      page: { type: 'number', description: 'Page number (default 1)' },
      pageSize: { type: 'number', description: 'Page size (default 20, max 100)' },
    },
  },
}

// 单条查询
export const get\${entityNamePascal}Tool: ToolDefinition = {
  name: 'get_\${entityName}',
  description: 'Get a single \${entityName} by id',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '\${entityNamePascal} ID' },
    },
    required: ['id'],
  },
}

// 创建
export const create\${entityNamePascal}Tool: ToolDefinition = {
  name: 'create_\${entityName}',
  description: 'Create a new \${entityName}',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Title' },
      content: { type: 'string', description: 'Content' },
    },
    required: ['title'],
  },
}

// 更新
export const update\${entityNamePascal}Tool: ToolDefinition = {
  name: 'update_\${entityName}',
  description: 'Update an existing \${entityName}',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '\${entityNamePascal} ID' },
      title: { type: 'string', description: 'New title' },
      content: { type: 'string', description: 'New content' },
    },
    required: ['id'],
  },
}

// 删除
export const delete\${entityNamePascal}Tool: ToolDefinition = {
  name: 'delete_\${entityName}',
  description: 'Delete a \${entityName} by id',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '\${entityNamePascal} ID' },
    },
    required: ['id'],
  },
}

export const \${entityName}Tools = [
  list\${entityNamePascal}Tool,
  get\${entityNamePascal}Tool,
  create\${entityNamePascal}Tool,
  update\${entityNamePascal}Tool,
  delete\${entityNamePascal}Tool,
]`,
  usage: '插入到 src/tools/index.ts；配合 tool-crud-executors 片段实现执行器；表结构需在 db/install.sql 中定义。',
}

// ==========================================
// CRUD 执行器集（与上一片段配套）
// ==========================================
export const toolCrudExecutorsSnippet: Snippet = {
  id: 'tool-crud-executors',
  name: 'CRUD Executors',
  nameZh: 'CRUD 执行器集',
  description: 'Executors for the CRUD tool set, using parameterized SQL',
  descriptionZh: 'CRUD 工具集对应的执行器，使用参数化 SQL 防注入',
  category: 'tool',
  applicableTypes: ['both'],
  language: 'typescript',
  icon: 'Play',
  tags: ['tool', 'crud', 'executor', 'sql'],
  difficulty: 'advanced',
  targetFile: 'src/tools/executors.ts',
  variables: [
    {
      name: 'tableName',
      defaultValue: 'records',
      description: 'Target table name',
      descriptionZh: '目标表名',
      required: true,
    },
    {
      name: 'entityName',
      defaultValue: 'record',
      description: 'Singular entity name',
      descriptionZh: '实体名单数形式',
      required: true,
    },
    {
      name: 'entityNamePascal',
      defaultValue: 'Record',
      description: 'PascalCase entity name',
      descriptionZh: 'PascalCase 实体名',
      required: true,
    },
  ],
  code: `import type { ToolExecutor } from '@shared/protocols/modelGateway'
import { generateId } from '../utils/id'

/**
 * \${entityNamePascal} CRUD 执行器
 * 表：\${tableName}
 * 使用参数化 SQL，杜绝注入
 */

export const list\${entityNamePascal}Executor: ToolExecutor = async (args, context) => {
  const keyword = (args.keyword as string)?.trim() || ''
  const page = Math.max(1, (args.page as number) || 1)
  const pageSize = Math.min(100, Math.max(1, (args.pageSize as number) || 20))
  const offset = (page - 1) * pageSize

  const where = keyword ? "WHERE title LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%'" : ''
  const params = keyword ? [keyword, keyword, pageSize, offset] : [pageSize, offset]

  const sql = 'SELECT id, title, content, created_at, updated_at FROM \${tableName} ' + where + ' ORDER BY created_at DESC LIMIT ? OFFSET ?'

  try {
    const result = await context.executeSql(sql, params)
    const rows = result.rows ?? []
    return {
      success: true,
      result: JSON.stringify({ data: rows, page, pageSize, total: rows.length }),
    }
  } catch (err) {
    context.getLogger().error('[list_\${entityName}] failed:', err)
    return { success: false, result: '', error: (err as Error).message }
  }
}

export const get\${entityNamePascal}Executor: ToolExecutor = async (args, context) => {
  const id = args.id as string
  if (!id?.trim()) return { success: false, result: '', error: 'id 不能为空' }

  try {
    const result = await context.executeSql(
      'SELECT id, title, content, created_at, updated_at FROM \${tableName} WHERE id = ?',
      [id],
    )
    const rows = result.rows ?? []
    if (rows.length === 0) {
      return { success: false, result: '', error: '\${entityName} 不存在' }
    }
    return { success: true, result: JSON.stringify(rows[0]) }
  } catch (err) {
    context.getLogger().error('[get_\${entityName}] failed:', err)
    return { success: false, result: '', error: (err as Error).message }
  }
}

export const create\${entityNamePascal}Executor: ToolExecutor = async (args, context) => {
  const title = (args.title as string)?.trim()
  const content = (args.content as string) || ''
  if (!title) return { success: false, result: '', error: 'title 不能为空' }

  const id = generateId()
  const now = new Date().toISOString()

  try {
    await context.executeSql(
      'INSERT INTO \${tableName} (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, title, content, now, now],
    )
    return {
      success: true,
      result: JSON.stringify({ id, title, content, message: '\${entityName} 创建成功' }),
    }
  } catch (err) {
    context.getLogger().error('[create_\${entityName}] failed:', err)
    return { success: false, result: '', error: (err as Error).message }
  }
}

export const update\${entityNamePascal}Executor: ToolExecutor = async (args, context) => {
  const id = args.id as string
  if (!id?.trim()) return { success: false, result: '', error: 'id 不能为空' }

  const fields: string[] = []
  const params: unknown[] = []
  if (args.title !== undefined) { fields.push('title = ?'); params.push(args.title) }
  if (args.content !== undefined) { fields.push('content = ?'); params.push(args.content) }
  if (fields.length === 0) {
    return { success: false, result: '', error: '至少提供 title 或 content' }
  }
  fields.push('updated_at = ?')
  params.push(new Date().toISOString())
  params.push(id)

  try {
    const result = await context.executeSql(
      'UPDATE \${tableName} SET ' + fields.join(', ') + ' WHERE id = ?',
      params,
    )
    if ((result.rowsAffected ?? 0) === 0) {
      return { success: false, result: '', error: '\${entityName} 不存在或未变更' }
    }
    return { success: true, result: JSON.stringify({ id, message: '\${entityName} 更新成功' }) }
  } catch (err) {
    context.getLogger().error('[update_\${entityName}] failed:', err)
    return { success: false, result: '', error: (err as Error).message }
  }
}

export const delete\${entityNamePascal}Executor: ToolExecutor = async (args, context) => {
  const id = args.id as string
  if (!id?.trim()) return { success: false, result: '', error: 'id 不能为空' }

  try {
    const result = await context.executeSql('DELETE FROM \${tableName} WHERE id = ?', [id])
    if ((result.rowsAffected ?? 0) === 0) {
      return { success: false, result: '', error: '\${entityName} 不存在' }
    }
    return { success: true, result: JSON.stringify({ id, message: '\${entityName} 已删除' }) }
  } catch (err) {
    context.getLogger().error('[delete_\${entityName}] failed:', err)
    return { success: false, result: '', error: (err as Error).message }
  }
}`,
  usage: '插入到 src/tools/executors.ts；需配套引入 generateId 工具；EXECUTOR_MAP 中注册 5 个执行器映射。',
}
