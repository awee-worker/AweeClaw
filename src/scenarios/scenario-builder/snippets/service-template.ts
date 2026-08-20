/**
 * 服务模板代码片段集合
 *
 * 提供场景开发中常用的服务层模板：
 *  - service-class:    单实体服务类（含 CRUD）
 *  - service-factory: 依赖注入式服务工厂
 */
import type { Snippet } from './types'

// ==========================================
// 单实体服务类
// ==========================================
export const serviceClassSnippet: Snippet = {
  id: 'service-class',
  name: 'Service Class',
  nameZh: '服务类模板',
  description: 'Single-entity service class with CRUD methods using context SQL API',
  descriptionZh: '单实体服务类模板：包含 CRUD 方法，使用 context 的 SQL API',
  category: 'service',
  applicableTypes: ['both'],
  language: 'typescript',
  icon: 'Server',
  tags: ['service', 'class', 'crud', 'template'],
  difficulty: 'intermediate',
  targetFile: 'src/services/EntityService.ts',
  variables: [
    {
      name: 'entityNamePascal',
      defaultValue: 'Record',
      description: 'Entity name in PascalCase',
      descriptionZh: '实体名 PascalCase',
      required: true,
    },
    {
      name: 'entityName',
      defaultValue: 'record',
      description: 'Entity name in singular',
      descriptionZh: '实体名单数',
      required: true,
    },
    {
      name: 'tableName',
      defaultValue: 'records',
      description: 'Database table name',
      descriptionZh: '数据库表名',
      required: true,
    },
  ],
  code: `import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'

export interface \${entityNamePascal} {
  id: string
  title: string
  content: string
  created_at: string
  updated_at: string
}

export interface ListOptions {
  keyword?: string
  page?: number
  pageSize?: number
}

/**
 * \${entityNamePascal} 服务
 * - 单一职责：仅操作 \${tableName} 表
 * - 依赖注入：通过构造函数注入 context
 * - 参数化 SQL：所有查询使用 ? 占位，杜绝注入
 */
export class \${entityNamePascal}Service {
  constructor(private readonly context: ScenarioModuleContext) {}

  private get log() {
    return this.context.getLogger()
  }

  async list(opts: ListOptions = {}): Promise<{ data: \${entityNamePascal}[]; total: number }> {
    const keyword = opts.keyword?.trim() || ''
    const page = Math.max(1, opts.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20))
    const offset = (page - 1) * pageSize

    const where = keyword
      ? "WHERE title LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%'"
      : ''
    const params = keyword ? [keyword, keyword, pageSize, offset] : [pageSize, offset]

    try {
      const result = await this.context.executeSql(
        'SELECT id, title, content, created_at, updated_at FROM \${tableName} ' + where + ' ORDER BY created_at DESC LIMIT ? OFFSET ?',
        params,
      )
      const data = (result.rows ?? []) as \${entityNamePascal}[]
      const countResult = await this.context.executeSql(
        'SELECT COUNT(*) as total FROM \${tableName} ' + where,
        keyword ? [keyword, keyword] : [],
      )
      const total = ((countResult.rows ?? [])[0] as { total?: number })?.total ?? data.length
      return { data, total }
    } catch (err) {
      this.log.error('[\${entityName}Service.list] failed:', err)
      throw err
    }
  }

  async getById(id: string): Promise<\${entityNamePascal} | null> {
    if (!id?.trim()) return null
    try {
      const result = await this.context.executeSql(
        'SELECT id, title, content, created_at, updated_at FROM \${tableName} WHERE id = ?',
        [id],
      )
      const rows = (result.rows ?? []) as \${entityNamePascal}[]
      return rows[0] ?? null
    } catch (err) {
      this.log.error('[\${entityName}Service.getById] failed:', err)
      throw err
    }
  }

  async create(input: { title: string; content?: string }): Promise<\${entityNamePascal}> {
    const title = input.title?.trim()
    if (!title) throw new Error('title 不能为空')
    const id = '\${entityName}-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const now = new Date().toISOString()
    const content = input.content ?? ''

    try {
      await this.context.executeSql(
        'INSERT INTO \${tableName} (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [id, title, content, now, now],
      )
      return { id, title, content, created_at: now, updated_at: now }
    } catch (err) {
      this.log.error('[\${entityName}Service.create] failed:', err)
      throw err
    }
  }

  async update(id: string, patch: { title?: string; content?: string }): Promise<boolean> {
    if (!id?.trim()) throw new Error('id 不能为空')
    const fields: string[] = []
    const params: unknown[] = []
    if (patch.title !== undefined) { fields.push('title = ?'); params.push(patch.title.trim()) }
    if (patch.content !== undefined) { fields.push('content = ?'); params.push(patch.content) }
    if (fields.length === 0) throw new Error('至少提供 title 或 content')
    fields.push('updated_at = ?')
    params.push(new Date().toISOString())
    params.push(id)

    try {
      const result = await this.context.executeSql(
        'UPDATE \${tableName} SET ' + fields.join(', ') + ' WHERE id = ?',
        params,
      )
      return (result.rowsAffected ?? 0) > 0
    } catch (err) {
      this.log.error('[\${entityName}Service.update] failed:', err)
      throw err
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!id?.trim()) throw new Error('id 不能为空')
    try {
      const result = await this.context.executeSql('DELETE FROM \${tableName} WHERE id = ?', [id])
      return (result.rowsAffected ?? 0) > 0
    } catch (err) {
      this.log.error('[\${entityName}Service.delete] failed:', err)
      throw err
    }
  }
}`,
  usage: '放置到 src/services/\${entityNamePascal}Service.ts；在 src/index.ts 的 onActivate 中实例化并存入 context 供工具调用。',
}

// ==========================================
// 服务工厂（依赖注入）
// ==========================================
export const serviceFactorySnippet: Snippet = {
  id: 'service-factory',
  name: 'Service Factory',
  nameZh: '服务工厂模板',
  description: 'Service factory with lazy initialization and context injection',
  descriptionZh: '服务工厂：延迟初始化 + context 注入',
  category: 'service',
  applicableTypes: ['programmatic'],
  language: 'typescript',
  icon: 'Factory',
  tags: ['service', 'factory', 'di', 'lazy'],
  difficulty: 'advanced',
  targetFile: 'src/services/index.ts',
  variables: [],
  code: `import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'

/**
 * 服务工厂
 * - 延迟初始化：首次访问时创建实例
 * - 单例：context 切换时重新初始化
 * - 类型安全：所有服务类型显式声明
 */
export class ServiceFactory {
  private context: ScenarioModuleContext | null = null
  private instances = new Map<string, unknown>()

  /** 注入 context，并清理旧实例 */
  setContext(context: ScenarioModuleContext): void {
    this.context = context
    this.instances.clear()
  }

  private get ctx(): ScenarioModuleContext {
    if (!this.context) throw new Error('ServiceFactory: context not set')
    return this.context
  }

  /** 获取或创建服务实例 */
  private getOrInit<T>(key: string, ctor: new (ctx: ScenarioModuleContext) => T): T {
    let instance = this.instances.get(key) as T | undefined
    if (!instance) {
      instance = new ctor(this.ctx)
      this.instances.set(key, instance)
    }
    return instance
  }

  // 在此声明服务访问器
  // 示例：
  // getRecordService(): RecordService {
  //   return this.getOrInit('RecordService', RecordService)
  // }
}

export const serviceFactory = new ServiceFactory()`,
  usage: '在 src/index.ts 的 onActivate 中调用 serviceFactory.setContext(context)；在工具执行器中通过 serviceFactory.getXxxService() 获取实例。',
}
