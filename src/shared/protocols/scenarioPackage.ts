/**
 * ScenarioPackage System - 场景包系统
 *
 * 把分发单位从「技能包（Markdown + 脚本）」提升为「场景包」：
 * 场景包除了提示词，还携带工具依赖、权限声明、UI 组件与数据 Schema，
 * 使一个场景能在新环境完整还原，而不是只还原一段说明文字。
 *
 * 与 SkillPackage 的关系：
 * 场景包是其上层扩展，沿用同一套约定（语义化版本、依赖声明、requiredToolPacks、
 * 场景绑定），不另起体系。差异在于场景包多了「权限声明」与「UI / 数据」两块，
 * 前者是安装前必须让用户看清的内容。
 */

// ============================================
// 场景包清单
// ============================================

export type ScenarioPackageCategory =
  | 'office'
  | 'data'
  | 'coding'
  | 'creative'
  | 'automation'
  | 'integration'
  | 'custom'

export interface ScenarioPackageManifest {
  id: string
  name: string
  /** 中文名，用于本地化展示 */
  nameZh?: string
  version: string
  description: string
  descriptionZh?: string
  author: string
  license?: string
  homepage?: string
  category: ScenarioPackageCategory
  tags?: string[]

  /** 提示词与智能体定义 */
  agent: ScenarioAgentDefinition
  /** 需要的工具 */
  requiredTools: string[]
  /** 需要的工具包 */
  requiredToolPacks: string[]
  /** 权限声明（安装时向用户展示） */
  permissions: ScenarioPermission[]
  /** UI 组件声明 */
  widgets?: ScenarioWidget[]
  /** 数据 Schema */
  data?: ScenarioDataSchema
  /** 依赖的场景包 */
  dependencies?: ScenarioPackageDependency[]
}

export interface ScenarioAgentDefinition {
  /** 系统提示词 */
  systemPrompt: string
  /** 场景模式标识 */
  sceneMode?: string
}

/** 权限类型 */
export type ScenarioPermissionKind =
  | 'read'
  | 'write'
  | 'terminal'
  | 'network'
  | 'external_agent'

export interface ScenarioPermission {
  kind: ScenarioPermissionKind
  /** 权限作用范围（路径 / 域名 / 工具类别） */
  scope: string
  /** 申请理由，安装时展示给用户 */
  reason: string
}

export interface ScenarioWidget {
  id: string
  /** 组件入口路径 */
  entry: string
  title?: string
}

export interface ScenarioDataSchema {
  schema: Record<string, unknown>
  migrations?: string[]
}

export interface ScenarioPackageDependency {
  id: string
  version: string
}

// ============================================
// 已安装的场景包
// ============================================

export interface InstalledScenarioPackage {
  manifest: ScenarioPackageManifest
  installPath: string
  installedAt: number
  updatedAt: number
  source: 'builtin' | 'marketplace' | 'git' | 'local'
  enabled: boolean
  config?: Record<string, unknown>
}

// ============================================
// 校验
// ============================================

export interface ScenarioPackageValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

const PERMISSION_KINDS: ScenarioPermissionKind[] = [
  'read',
  'write',
  'terminal',
  'network',
  'external_agent',
]

/** 语义化版本格式（允许预发布后缀） */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** 场景包 id 只允许小写字母、数字与连字符，避免成为路径穿越的入口 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/**
 * 校验场景包清单
 *
 * 分成 errors 与 warnings 两档：缺 id / version / 权限声明是安装硬阻断，
 * 缺中文名、缺 tags 之类只提示，不影响安装。
 */
export function validateScenarioPackageManifest(
  manifest: ScenarioPackageManifest | null | undefined,
): ScenarioPackageValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['清单缺失或格式不正确'], warnings }
  }

  if (!manifest.id) errors.push('缺少 id')
  else if (!ID_PATTERN.test(manifest.id)) {
    errors.push(`id 不合法：${manifest.id}（只允许小写字母、数字与连字符）`)
  }

  if (!manifest.name) errors.push('缺少 name')
  if (!manifest.description) errors.push('缺少 description')

  if (!manifest.version) errors.push('缺少 version')
  else if (!VERSION_PATTERN.test(manifest.version)) {
    errors.push(`version 不符合语义化版本：${manifest.version}`)
  }

  if (!manifest.agent || typeof manifest.agent !== 'object') {
    errors.push('缺少 agent 定义')
  } else if (!manifest.agent.systemPrompt) {
    errors.push('agent.systemPrompt 为空')
  }

  if (!Array.isArray(manifest.requiredTools)) errors.push('requiredTools 必须是数组')
  if (!Array.isArray(manifest.requiredToolPacks)) errors.push('requiredToolPacks 必须是数组')

  if (!Array.isArray(manifest.permissions)) {
    errors.push('缺少权限声明：安装前必须让用户看清该场景要什么权限')
  } else {
    for (const permission of manifest.permissions) {
      if (!PERMISSION_KINDS.includes(permission?.kind)) {
        errors.push(`未知的权限类型：${String(permission?.kind)}`)
        continue
      }
      if (!permission.scope) errors.push(`权限 ${permission.kind} 缺少 scope`)
      if (!permission.reason) errors.push(`权限 ${permission.kind} 缺少申请理由`)
    }
  }

  if (manifest.dependencies) {
    for (const dependency of manifest.dependencies) {
      if (!dependency?.id) errors.push('依赖项缺少 id')
      if (!dependency?.version) errors.push(`依赖 ${dependency?.id ?? '未知'} 缺少版本约束`)
    }
  }

  if (manifest.widgets) {
    for (const widget of manifest.widgets) {
      if (!widget?.id) errors.push('UI 组件缺少 id')
      if (!widget?.entry) errors.push(`UI 组件 ${widget?.id ?? '未知'} 缺少入口`)
    }
  }

  if (!manifest.nameZh) warnings.push('缺少中文名，界面将回退到默认名称')
  if (!manifest.tags || manifest.tags.length === 0) warnings.push('缺少标签，市场检索命中率会偏低')
  if (manifest.permissions && manifest.permissions.length === 0) {
    warnings.push('未声明任何权限：请确认该场景确实不需要访问用户数据')
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ============================================
// 版本与依赖
// ============================================

/** 比较语义化版本，返回 -1 / 0 / 1；无法解析时按字符串比较 */
export function compareVersion(a: string, b: string): number {
  const parse = (value: string): number[] | null => {
    const match = value.match(/^(\d+)\.(\d+)\.(\d+)/)
    if (!match) return null
    return [Number(match[1]), Number(match[2]), Number(match[3])]
  }

  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return a === b ? 0 : a > b ? 1 : -1

  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  }
  return 0
}

export interface DependencyResolution {
  /** 按安装顺序排列的包 id */
  order: string[]
  /** 缺失的依赖：id → 被谁依赖 */
  missing: Array<{ id: string; requiredBy: string; version: string }>
  /** 版本冲突：同一依赖被要求了不同版本 */
  conflicts: Array<{ id: string; required: string[] }>
}

/**
 * 解析安装顺序与缺依赖
 *
 * 与技能包一致采用拓扑排序：依赖先装。
 * 缺依赖与版本冲突都显式返回，不静默失败——安装到一半才报错比不装更糟。
 */
export function resolveScenarioInstallOrder(
  manifests: ScenarioPackageManifest[],
): DependencyResolution {
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  const order: string[] = []
  const missing: DependencyResolution['missing'] = []
  const requestedVersions = new Map<string, string[]>()

  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (id: string) => {
    if (visited.has(id) || visiting.has(id)) return
    visiting.add(id)

    const manifest = byId.get(id)
    for (const dependency of manifest?.dependencies ?? []) {
      const versions = requestedVersions.get(dependency.id) ?? []
      versions.push(dependency.version)
      requestedVersions.set(dependency.id, versions)

      if (!byId.has(dependency.id)) {
        missing.push({ id: dependency.id, requiredBy: id, version: dependency.version })
        continue
      }
      visit(dependency.id)
    }

    visiting.delete(id)
    visited.add(id)
    order.push(id)
  }

  for (const manifest of manifests) visit(manifest.id)

  const conflicts = Array.from(requestedVersions.entries())
    .filter(([, versions]) => new Set(versions).size > 1)
    .map(([id, versions]) => ({ id, required: Array.from(new Set(versions)) }))

  return { order, missing, conflicts }
}

// ============================================
// 升级
// ============================================

export interface ScenarioPackageUpgradePlan {
  /** 是否构成升级 */
  canUpgrade: boolean
  from: string
  to: string
  /** 需要按顺序执行的迁移脚本 */
  migrations: string[]
  /** 不能升级的原因 */
  reason?: string
}

/**
 * 规划场景包升级
 *
 * 升级不只是替换文件：清单里 data.migrations 声明的步骤必须按序执行，
 * 否则旧数据结构会与新代码对不上。这里只产出计划，不执行迁移。
 */
export function planScenarioPackageUpgrade(
  current: ScenarioPackageManifest | null,
  next: ScenarioPackageManifest,
): ScenarioPackageUpgradePlan {
  if (!current) {
    return { canUpgrade: true, from: '', to: next.version, migrations: [], reason: '首次安装' }
  }

  if (current.id !== next.id) {
    return {
      canUpgrade: false,
      from: current.version,
      to: next.version,
      migrations: [],
      reason: `场景包 id 不一致：${current.id} → ${next.id}`,
    }
  }

  if (compareVersion(next.version, current.version) <= 0) {
    return {
      canUpgrade: false,
      from: current.version,
      to: next.version,
      migrations: [],
      reason: `目标版本不高于当前版本（${current.version} → ${next.version}）`,
    }
  }

  return {
    canUpgrade: true,
    from: current.version,
    to: next.version,
    migrations: next.data?.migrations ?? [],
  }
}

// ============================================
// 安装前展示
// ============================================

/** 权限类型的中英文案 */
const PERMISSION_LABELS: Record<ScenarioPermissionKind, { zh: string; en: string }> = {
  read: { zh: '读取文件', en: 'Read files' },
  write: { zh: '写入文件', en: 'Write files' },
  terminal: { zh: '执行命令', en: 'Run commands' },
  network: { zh: '访问网络', en: 'Network access' },
  external_agent: { zh: '调用外部智能体', en: 'Call external agents' },
}

export function describePermission(
  kind: ScenarioPermissionKind,
  language: 'zh' | 'en' = 'zh',
): string {
  const label = PERMISSION_LABELS[kind]
  if (!label) return String(kind)
  return language === 'en' ? label.en : label.zh
}

/**
 * 渲染安装前的权限声明
 *
 * 逐条列出「要什么权限、用在哪、为什么」，用户确认后才落地安装。
 */
export function renderPermissionSummary(
  manifest: ScenarioPackageManifest,
  language: 'zh' | 'en' = 'zh',
): string {
  const permissions = manifest.permissions ?? []
  if (permissions.length === 0) {
    return language === 'en'
      ? 'This scenario requests no permissions.'
      : '该场景未申请任何权限。'
  }

  const title = language === 'en'
    ? `"${manifest.name}" requests the following permissions:`
    : `「${manifest.nameZh || manifest.name}」申请以下权限：`

  const lines = [title]
  for (const permission of permissions) {
    const label = describePermission(permission.kind, language)
    lines.push(`- ${label}｜范围：${permission.scope}｜原因：${permission.reason}`)
  }
  return lines.join('\n')
}
