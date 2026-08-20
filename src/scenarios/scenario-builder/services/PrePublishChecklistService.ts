/**
 * 发布前预检查服务（Pre-Publish Checklist Service）
 *
 * 在场景发布到市场前对项目进行系统化质量检查，输出可视化清单：
 *  - manifest：scenario.json 必填字段、ID/版本号格式
 *  - permissions：权限声明最小化、危险权限告警
 *  - prompts：提示词安全审查（注入指令、越权提示）
 *  - dependencies：依赖循环、自依赖
 *  - changelog：CHANGELOG.md 存在且包含当前版本条目
 *  - license：LICENSE 文件存在
 *  - database：SQL 脚本安全性（IF NOT EXISTS / DROP IF EXISTS / 无 WHERE 的 DELETE）
 *  - structure：编程式入口文件存在性
 *
 * 数据流：
 *   传入 ScenarioProject → 并行读取关键文件 → 逐项检查 → 返回 ChecklistResult
 *
 * 设计要点：
 *  - 文件读取通过 scenarioBuilderReadFile IPC，复用既有越权防护
 *  - 单文件缺失不阻断后续检查，仅标记该项为 fail
 *  - severity 分四档：critical（阻断发布）/ warning（建议修复）/ info（提示）/ pass（通过）
 *  - 检查项提供 fixSuggestionZh，供 UI 一键修复按钮使用
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'
import type { ScenarioProject } from '../types'

// ==========================================
// 类型定义
// ==========================================

export type ChecklistSeverity = 'critical' | 'warning' | 'info' | 'pass'
export type ChecklistStatus = 'pass' | 'fail' | 'skipped'

export type ChecklistCategory =
  | 'manifest'
  | 'permissions'
  | 'prompts'
  | 'dependencies'
  | 'changelog'
  | 'license'
  | 'database'
  | 'structure'

/** 单项检查结果 */
export interface ChecklistItem {
  /** 检查项 ID（唯一） */
  id: string
  /** 分类 */
  category: ChecklistCategory
  /** 英文标签 */
  label: string
  /** 中文标签 */
  labelZh: string
  /** 严重程度 */
  severity: ChecklistSeverity
  /** 状态：通过 / 失败 / 跳过（不适用） */
  status: ChecklistStatus
  /** 详细说明（英文） */
  detail?: string
  /** 详细说明（中文） */
  detailZh?: string
  /** 修复建议（英文） */
  fixSuggestion?: string
  /** 修复建议（中文） */
  fixSuggestionZh?: string
}

/** 检查结果汇总 */
export interface ChecklistResult {
  /** 项目 ID */
  projectId: string
  /** 全部检查项 */
  items: ChecklistItem[]
  /** 是否可以发布（无 critical 项即视为可发布） */
  publishable: boolean
  /** critical 项数量 */
  criticalCount: number
  /** warning 项数量 */
  warningCount: number
  /** pass 项数量 */
  passCount: number
  /** skipped 项数量 */
  skippedCount: number
  /** 检查耗时（ms） */
  durationMs: number
  /** 检查发生时间（ISO） */
  checkedAt: string
}

// ==========================================
// 危险权限与提示词注入模式
// ==========================================

/**
 * 危险权限清单
 *  - filesystem:write：可写文件系统，需提示用户确认范围
 *  - terminal:execute：可执行任意命令，风险最高
 *  - system:info：可读取系统信息
 *  - network:open-external：可打开外部 URL
 */
const DANGEROUS_PERMISSIONS: Record<string, string> = {
  'filesystem:write': '可写文件系统，请确认是否真有必要',
  'terminal:execute': '可执行任意命令，仅在脚本化场景才声明',
  'system:info': '可读取系统信息（hostname/平台/内存等）',
  'network:open-external': '可打开外部 URL，存在钓鱼风险',
}

/**
 * 提示词注入检测模式
 *  - "ignore previous" / "ignore all rules" / "disregard prior" 等典型越权指令
 *  - 提示词中不应包含此类让 AI 抛弃既定角色的语句
 */
const PROMPT_INJECTION_PATTERNS: Array<{ pattern: RegExp; labelZh: string }> = [
  { pattern: /ignore\s+(previous|prior|all|above|earlier)\s+(instructions?|rules?|prompts?)/i, labelZh: '包含"忽略先前指令"等越权语句' },
  { pattern: /disregard\s+(prior|previous|all|above)\s+(instructions?|rules?)/i, labelZh: '包含"无视先前指令"等越权语句' },
  { pattern: /forget\s+(everything|all\s+previous|prior\s+rules)/i, labelZh: '包含"忘记先前所有规则"等越权语句' },
  { pattern: /(jailbreak|DAN\s+mode|developer\s+mode\s+enabled)/i, labelZh: '包含越狱/开发者模式关键词' },
  { pattern: /(system\s+prompt|instructions?\s+above)\s+(is|are)\s+(not|no\s+longer)\s+(applicable|valid)/i, labelZh: '声明系统提示词失效' },
]

/**
 * 危险 SQL 模式
 *  - DROP DATABASE：场景脚本不应删除数据库
 *  - DELETE FROM xxx（无 WHERE）：可能清空表
 *  - TRUNCATE：清空表数据
 */
const DANGEROUS_SQL_PATTERNS: Array<{ pattern: RegExp; labelZh: string }> = [
  { pattern: /DROP\s+DATABASE/i, labelZh: '包含 DROP DATABASE（不允许）' },
  { pattern: /DELETE\s+FROM\s+\w+\s*(;|$)/i, labelZh: '包含无 WHERE 的 DELETE（会清空表）' },
  { pattern: /TRUNCATE\s+TABLE/i, labelZh: '包含 TRUNCATE TABLE' },
]

// ==========================================
// 服务实现
// ==========================================

interface FileReadResult {
  success: boolean
  content: string
  error?: string
}

export class PrePublishChecklistService {
  private context: ScenarioModuleContext | null = null

  setContext(context: ScenarioModuleContext): void {
    this.context = context
  }

  private getContext(): ScenarioModuleContext {
    if (!this.context) {
      throw new Error('PrePublishChecklistService: context not set. Call setContext() first.')
    }
    return this.context
  }

  /**
   * 通过 IPC 读取场景项目内的文件
   *  - 复用 scenarioBuilderReadFile，主进程会做路径越权防护
   *  - 文件不存在时返回 success:false，不抛错
   */
  private async readFile(projectPath: string, relativePath: string): Promise<FileReadResult> {
    if (typeof window === 'undefined' || !(window as any).electronAPI?.scenarioBuilderReadFile) {
      return { success: false, content: '', error: 'Electron API not available' }
    }
    try {
      const result = await (window as any).electronAPI.scenarioBuilderReadFile({
        projectPath,
        relativePath,
      })
      return {
        success: result?.success === true,
        content: result?.content ?? '',
        error: result?.error,
      }
    } catch (err) {
      return { success: false, content: '', error: (err as Error).message }
    }
  }

  /**
   * 并行读取多个文件
   *  - 任一文件失败不影响其他文件
   */
  private async readFiles(
    projectPath: string,
    relativePaths: string[],
  ): Promise<Record<string, FileReadResult>> {
    const entries = await Promise.all(
      relativePaths.map(async (p) => {
        const r = await this.readFile(projectPath, p)
        return [p, r] as const
      }),
    )
    const map: Record<string, FileReadResult> = {}
    for (const [p, r] of entries) map[p] = r
    return map
  }

  /**
   * 执行发布前预检查
   *
   * @param project 场景项目（含 localPath / version / type / scenarioId 等）
   */
  async runChecks(project: ScenarioProject): Promise<ChecklistResult> {
    const ctx = this.getContext()
    const log = ctx.getLogger()
    const startedAt = Date.now()
    const items: ChecklistItem[] = []

    // 1. 并行读取关键文件
    const filesToRead = [
      'scenario.json',
      'prompts/system.md',
      'prompts/security.md',
      'db/install.sql',
      'db/uninstall.sql',
      'CHANGELOG.md',
      'LICENSE',
      'src/index.ts',
    ]
    const files = await this.readFiles(project.localPath, filesToRead)

    // 2. 逐项检查
    items.push(...this.checkManifest(project, files))
    items.push(...this.checkPermissions(project, files))
    items.push(...this.checkPrompts(project, files))
    items.push(...this.checkDependencies(project, files))
    items.push(...this.checkChangelog(project, files))
    items.push(...this.checkLicense(project, files))
    items.push(...this.checkDatabase(project, files))
    items.push(...this.checkStructure(project, files))

    // 3. 汇总
    const criticalCount = items.filter((i) => i.severity === 'critical' && i.status === 'fail').length
    const warningCount = items.filter((i) => i.severity === 'warning' && i.status === 'fail').length
    const passCount = items.filter((i) => i.status === 'pass').length
    const skippedCount = items.filter((i) => i.status === 'skipped').length
    const publishable = criticalCount === 0

    log.info(
      `[PrePublishChecklist] project=${project.id} critical=${criticalCount} warning=${warningCount} pass=${passCount} skipped=${skippedCount}`,
    )

    return {
      projectId: project.id,
      items,
      publishable,
      criticalCount,
      warningCount,
      passCount,
      skippedCount,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    }
  }

  // ==========================================
  // 检查项：manifest
  // ==========================================

  private checkManifest(
    project: ScenarioProject,
    files: Record<string, FileReadResult>,
  ): ChecklistItem[] {
    const items: ChecklistItem[] = []
    const sc = files['scenario.json']

    // scenario.json 存在性
    if (!sc?.success) {
      items.push({
        id: 'manifest.exists',
        category: 'manifest',
        label: 'scenario.json exists',
        labelZh: 'scenario.json 文件存在',
        severity: 'critical',
        status: 'fail',
        detail: sc?.error || 'File not found',
        detailZh: sc?.error ? `读取失败：${sc.error}` : '项目根目录缺少 scenario.json',
        fixSuggestion: 'Create scenario.json in project root',
        fixSuggestionZh: '在项目根目录创建 scenario.json',
      })
      return items
    }

    // 解析 JSON
    let config: Record<string, unknown> = {}
    try {
      config = JSON.parse(sc.content)
    } catch (err) {
      items.push({
        id: 'manifest.parse',
        category: 'manifest',
        label: 'scenario.json is valid JSON',
        labelZh: 'scenario.json 是合法 JSON',
        severity: 'critical',
        status: 'fail',
        detail: (err as Error).message,
        detailZh: `JSON 解析失败：${(err as Error).message}`,
        fixSuggestion: 'Fix JSON syntax errors',
        fixSuggestionZh: '修复 JSON 语法错误（多余逗号、引号未闭合等）',
      })
      return items
    }

    // 必填字段
    const requiredFields: Array<{ key: string; labelZh: string }> = [
      { key: 'id', labelZh: '场景 ID' },
      { key: 'version', labelZh: '版本号' },
      { key: 'name', labelZh: '英文名' },
      { key: 'nameZh', labelZh: '中文名' },
      { key: 'type', labelZh: '场景类型' },
      { key: 'author', labelZh: '作者' },
      { key: 'icon', labelZh: '图标' },
      { key: 'category', labelZh: '分类' },
    ]
    for (const { key, labelZh } of requiredFields) {
      const val = config[key]
      const present = val !== undefined && val !== null && String(val).trim().length > 0
      items.push({
        id: `manifest.field.${key}`,
        category: 'manifest',
        label: `manifest has field: ${key}`,
        labelZh: `manifest 包含字段：${labelZh}`,
        severity: 'critical',
        status: present ? 'pass' : 'fail',
        detail: present ? undefined : `Missing field: ${key}`,
        detailZh: present ? undefined : `缺少必填字段：${key}（${labelZh}）`,
        fixSuggestion: present ? undefined : `Add "${key}" to scenario.json`,
        fixSuggestionZh: present ? undefined : `在 scenario.json 中添加 "${key}" 字段`,
      })
    }

    // ID 格式
    const idVal = String(config.id ?? '')
    if (idVal && !/^[a-z][a-z0-9-]*$/.test(idVal)) {
      items.push({
        id: 'manifest.id.format',
        category: 'manifest',
        label: 'Scenario ID format',
        labelZh: '场景 ID 格式',
        severity: 'critical',
        status: 'fail',
        detail: `ID "${idVal}" does not match ^[a-z][a-z0-9-]*$`,
        detailZh: `ID "${idVal}" 不符合规范（小写字母+数字+连字符，字母开头）`,
        fixSuggestion: 'Use lowercase letters, digits and hyphens; start with a letter',
        fixSuggestionZh: '改为小写字母+数字+连字符，且以字母开头',
      })
    }

    // 版本格式（语义化）
    const versionVal = String(config.version ?? '')
    if (versionVal && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(versionVal)) {
      items.push({
        id: 'manifest.version.format',
        category: 'manifest',
        label: 'Semantic version format',
        labelZh: '语义化版本号格式',
        severity: 'warning',
        status: 'fail',
        detail: `Version "${versionVal}" is not semver`,
        detailZh: `版本号 "${versionVal}" 不是语义化版本（如 1.0.0）`,
        fixSuggestion: 'Use MAJOR.MINOR.PATCH format',
        fixSuggestionZh: '使用 主版本.次版本.修订号 格式（如 1.0.0）',
      })
    }

    // ID 与项目一致
    if (idVal && idVal !== project.scenarioId) {
      items.push({
        id: 'manifest.id.consistency',
        category: 'manifest',
        label: 'ID matches project scenarioId',
        labelZh: 'scenario.json ID 与项目一致',
        severity: 'warning',
        status: 'fail',
        detail: `manifest id="${idVal}" vs project scenarioId="${project.scenarioId}"`,
        detailZh: `scenario.json 中 id="${idVal}" 与项目 scenarioId="${project.scenarioId}" 不一致`,
        fixSuggestion: 'Align scenario.json id with project scenarioId',
        fixSuggestionZh: '将 scenario.json 的 id 改为与项目 scenarioId 一致',
      })
    }

    return items
  }

  // ==========================================
  // 检查项：permissions
  // ==========================================

  private checkPermissions(
    _project: ScenarioProject,
    files: Record<string, FileReadResult>,
  ): ChecklistItem[] {
    const items: ChecklistItem[] = []
    const sc = files['scenario.json']
    if (!sc?.success) return []

    let config: Record<string, unknown> = {}
    try {
      config = JSON.parse(sc.content)
    } catch {
      return [] // manifest 检查已报错
    }

    const permissions = Array.isArray(config.permissions) ? (config.permissions as string[]) : []
    if (permissions.length === 0) {
      items.push({
        id: 'permissions.empty',
        category: 'permissions',
        label: 'No permissions declared',
        labelZh: '未声明任何权限',
        severity: 'info',
        status: 'pass',
        detail: 'No permissions required',
        detailZh: '场景未声明任何权限，最小权限原则',
      })
      return items
    }

    // 危险权限告警
    const dangerous: string[] = []
    for (const p of permissions) {
      const normalized = String(p).toLowerCase()
      if (DANGEROUS_PERMISSIONS[normalized]) dangerous.push(p)
    }
    if (dangerous.length === 0) {
      items.push({
        id: 'permissions.minimal',
        category: 'permissions',
        label: 'Permissions look minimal',
        labelZh: '权限声明最小化',
        severity: 'info',
        status: 'pass',
        detail: `${permissions.length} permission(s) declared, none flagged as dangerous`,
        detailZh: `已声明 ${permissions.length} 个权限，未发现危险权限`,
      })
    } else {
      const reasons = dangerous
        .map((p) => `${p}（${DANGEROUS_PERMISSIONS[String(p).toLowerCase()]}）`)
        .join('；')
      items.push({
        id: 'permissions.dangerous',
        category: 'permissions',
        label: 'Dangerous permissions detected',
        labelZh: '检测到危险权限',
        severity: 'warning',
        status: 'fail',
        detail: `Dangerous: ${dangerous.join(', ')}`,
        detailZh: `危险权限：${reasons}`,
        fixSuggestion: 'Remove unused dangerous permissions',
        fixSuggestionZh: '移除未使用的危险权限，或确认确实必需',
      })
    }

    return items
  }

  // ==========================================
  // 检查项：prompts（提示词安全审查）
  // ==========================================

  private checkPrompts(
    _project: ScenarioProject,
    files: Record<string, FileReadResult>,
  ): ChecklistItem[] {
    const items: ChecklistItem[] = []
    const sys = files['prompts/system.md']

    // system.md 存在性
    if (!sys?.success) {
      items.push({
        id: 'prompts.system.exists',
        category: 'prompts',
        label: 'prompts/system.md exists',
        labelZh: 'prompts/system.md 文件存在',
        severity: 'critical',
        status: 'fail',
        detail: 'File not found',
        detailZh: '未找到 prompts/system.md，场景缺少核心系统提示词',
        fixSuggestion: 'Create prompts/system.md with role, capabilities and behavior rules',
        fixSuggestionZh: '创建 prompts/system.md，包含角色定位、能力描述和行为准则',
      })
      return items
    }
    items.push({
      id: 'prompts.system.exists',
      category: 'prompts',
      label: 'prompts/system.md exists',
      labelZh: 'prompts/system.md 文件存在',
      severity: 'info',
      status: 'pass',
    })

    // 内容长度（提示词太短可能能力描述不清）
    const content = sys.content
    if (content.trim().length < 100) {
      items.push({
        id: 'prompts.system.tooShort',
        category: 'prompts',
        label: 'System prompt too short',
        labelZh: '系统提示词过短',
        severity: 'warning',
        status: 'fail',
        detail: `Only ${content.trim().length} chars`,
        detailZh: `仅 ${content.trim().length} 字符，建议至少包含角色、能力、行为准则三部分`,
        fixSuggestion: 'Expand system prompt with role, capabilities and behavior rules',
        fixSuggestionZh: '扩充系统提示词，覆盖角色定位、能力清单、行为准则',
      })
    }

    // 注入指令检测
    const matched: string[] = []
    for (const { pattern, labelZh } of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(content)) matched.push(labelZh)
    }
    if (matched.length > 0) {
      items.push({
        id: 'prompts.injection',
        category: 'prompts',
        label: 'Prompt injection patterns detected',
        labelZh: '检测到提示词注入模式',
        severity: 'critical',
        status: 'fail',
        detail: `Matched: ${matched.join(' | ')}`,
        detailZh: `命中：${matched.join('；')}`,
        fixSuggestion: 'Remove any instructions that bypass the scenario role',
        fixSuggestionZh: '移除任何绕过场景角色设定的语句',
      })
    } else {
      items.push({
        id: 'prompts.injection',
        category: 'prompts',
        label: 'No prompt injection patterns',
        labelZh: '未检测到提示词注入模式',
        severity: 'info',
        status: 'pass',
      })
    }

    return items
  }

  // ==========================================
  // 检查项：dependencies（循环依赖、自依赖）
  // ==========================================

  private checkDependencies(
    project: ScenarioProject,
    files: Record<string, FileReadResult>,
  ): ChecklistItem[] {
    const items: ChecklistItem[] = []
    const sc = files['scenario.json']
    if (!sc?.success) return []

    let config: Record<string, unknown> = {}
    try {
      config = JSON.parse(sc.content)
    } catch {
      return []
    }

    const deps = Array.isArray(config.dependencies) ? (config.dependencies as Array<{ scenarioId: string; version: string }>) : []
    if (deps.length === 0) {
      items.push({
        id: 'dependencies.none',
        category: 'dependencies',
        label: 'No dependencies',
        labelZh: '无依赖场景',
        severity: 'info',
        status: 'pass',
        detailZh: '场景未声明任何依赖',
      })
      return items
    }

    // 自依赖
    const selfDep = deps.find((d) => d.scenarioId === project.scenarioId)
    if (selfDep) {
      items.push({
        id: 'dependencies.self',
        category: 'dependencies',
        label: 'Self-dependency detected',
        labelZh: '检测到自依赖',
        severity: 'critical',
        status: 'fail',
        detail: `depends on itself: ${selfDep.scenarioId}`,
        detailZh: `场景依赖自身：${selfDep.scenarioId}`,
        fixSuggestion: 'Remove self from dependencies',
        fixSuggestionZh: '从依赖列表中移除自身',
      })
    }

    // 重复依赖
    const ids = deps.map((d) => d.scenarioId)
    const dupIds = ids.filter((id, idx) => ids.indexOf(id) !== idx)
    if (dupIds.length > 0) {
      items.push({
        id: 'dependencies.duplicate',
        category: 'dependencies',
        label: 'Duplicate dependencies',
        labelZh: '存在重复依赖',
        severity: 'warning',
        status: 'fail',
        detail: `Duplicate: ${dupIds.join(', ')}`,
        detailZh: `重复依赖：${dupIds.join('，')}`,
        fixSuggestion: 'Remove duplicate entries',
        fixSuggestionZh: '移除重复的依赖条目',
      })
    }

    // 注：跨场景循环依赖需要读取所有已安装场景的 manifest，
    // 当前服务仅能读取本项目，跨项目循环检测在 publish 流程中由后端处理
    if (!selfDep && dupIds.length === 0) {
      items.push({
        id: 'dependencies.ok',
        category: 'dependencies',
        label: 'Dependencies look fine',
        labelZh: '依赖声明正常',
        severity: 'info',
        status: 'pass',
        detailZh: `共 ${deps.length} 个依赖，无自依赖、无重复`,
      })
    }

    return items
  }

  // ==========================================
  // 检查项：changelog
  // ==========================================

  private checkChangelog(
    project: ScenarioProject,
    files: Record<string, FileReadResult>,
  ): ChecklistItem[] {
    const items: ChecklistItem[] = []
    const cl = files['CHANGELOG.md']

    if (!cl?.success) {
      items.push({
        id: 'changelog.exists',
        category: 'changelog',
        label: 'CHANGELOG.md exists',
        labelZh: 'CHANGELOG.md 文件存在',
        severity: 'info',
        status: 'fail',
        detail: 'File not found',
        detailZh: '项目根目录缺少 CHANGELOG.md',
        fixSuggestion: 'Add a CHANGELOG.md following Keep a Changelog format',
        fixSuggestionZh: '按 Keep a Changelog 规范创建 CHANGELOG.md',
      })
      return items
    }

    // 是否包含当前版本条目
    const versionPattern = new RegExp(`^##\\s+\\[?v?${escapeRegex(project.version)}\\]?`, 'm')
    if (versionPattern.test(cl.content)) {
      items.push({
        id: 'changelog.currentVersion',
        category: 'changelog',
        label: `CHANGELOG has entry for v${project.version}`,
        labelZh: `CHANGELOG 包含 v${project.version} 条目`,
        severity: 'info',
        status: 'pass',
      })
    } else {
      items.push({
        id: 'changelog.currentVersion',
        category: 'changelog',
        label: `CHANGELOG missing entry for v${project.version}`,
        labelZh: `CHANGELOG 缺少 v${project.version} 条目`,
        severity: 'warning',
        status: 'fail',
        detail: `No "## [${project.version}]" section found`,
        detailZh: `未找到 "## [${project.version}]" 章节`,
        fixSuggestion: `Add a "## [${project.version}]" section describing changes`,
        fixSuggestionZh: `添加 "## [${project.version}]" 章节描述本次变更`,
      })
    }

    return items
  }

  // ==========================================
  // 检查项：license
  // ==========================================

  private checkLicense(
    _project: ScenarioProject,
    files: Record<string, FileReadResult>,
  ): ChecklistItem[] {
    const items: ChecklistItem[] = []
    const lic = files['LICENSE']

    if (lic?.success) {
      items.push({
        id: 'license.exists',
        category: 'license',
        label: 'LICENSE file exists',
        labelZh: 'LICENSE 文件存在',
        severity: 'info',
        status: 'pass',
      })
    } else {
      items.push({
        id: 'license.exists',
        category: 'license',
        label: 'LICENSE file missing',
        labelZh: 'LICENSE 文件缺失',
        severity: 'info',
        status: 'fail',
        detail: 'File not found',
        detailZh: '项目根目录缺少 LICENSE 文件',
        fixSuggestion: 'Add a LICENSE file (MIT/Apache-2.0/proprietary)',
        fixSuggestionZh: '添加 LICENSE 文件（MIT / Apache-2.0 / 商用授权）',
      })
    }

    return items
  }

  // ==========================================
  // 检查项：database 脚本安全性
  // ==========================================

  private checkDatabase(
    _project: ScenarioProject,
    files: Record<string, FileReadResult>,
  ): ChecklistItem[] {
    const items: ChecklistItem[] = []
    const install = files['db/install.sql']
    const uninstall = files['db/uninstall.sql']

    // 无 SQL 脚本视为不使用数据库，跳过
    if (!install?.success && !uninstall?.success) {
      items.push({
        id: 'database.skipped',
        category: 'database',
        label: 'No database scripts (skipped)',
        labelZh: '无数据库脚本（跳过）',
        severity: 'info',
        status: 'skipped',
        detailZh: '项目未提供 db/install.sql 和 db/uninstall.sql',
      })
      return items
    }

    // install.sql 安全检查
    if (install?.success) {
      // 危险 SQL
      const dangerousMatches: string[] = []
      for (const { pattern, labelZh } of DANGEROUS_SQL_PATTERNS) {
        if (pattern.test(install.content)) dangerousMatches.push(labelZh)
      }
      if (dangerousMatches.length > 0) {
        items.push({
          id: 'database.install.dangerous',
          category: 'database',
          label: 'install.sql contains dangerous SQL',
          labelZh: 'install.sql 包含危险 SQL',
          severity: 'critical',
          status: 'fail',
          detail: dangerousMatches.join(' | '),
          detailZh: dangerousMatches.join('；'),
          fixSuggestion: 'Remove DROP DATABASE / TRUNCATE / unguarded DELETE',
          fixSuggestionZh: '移除 DROP DATABASE / TRUNCATE / 无 WHERE 的 DELETE',
        })
      } else {
        items.push({
          id: 'database.install.dangerous',
          category: 'database',
          label: 'install.sql safe',
          labelZh: 'install.sql 安全',
          severity: 'info',
          status: 'pass',
        })
      }

      // CREATE TABLE 应使用 IF NOT EXISTS
      const createTableCount = (install.content.match(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?\w+/gi) || []).length
      const createWithIfNotExists = (install.content.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+\w+/gi) || []).length
      const plainCreate = createTableCount - createWithIfNotExists
      if (plainCreate > 0) {
        items.push({
          id: 'database.install.ifNotExists',
          category: 'database',
          label: 'CREATE TABLE uses IF NOT EXISTS',
          labelZh: 'CREATE TABLE 使用 IF NOT EXISTS',
          severity: 'warning',
          status: 'fail',
          detail: `${plainCreate} CREATE TABLE without IF NOT EXISTS`,
          detailZh: `${plainCreate} 个 CREATE TABLE 未使用 IF NOT EXISTS，重复安装会报错`,
          fixSuggestion: 'Add IF NOT EXISTS to all CREATE TABLE statements',
          fixSuggestionZh: '为所有 CREATE TABLE 添加 IF NOT EXISTS',
        })
      } else if (createTableCount > 0) {
        items.push({
          id: 'database.install.ifNotExists',
          category: 'database',
          label: 'CREATE TABLE uses IF NOT EXISTS',
          labelZh: 'CREATE TABLE 使用 IF NOT EXISTS',
          severity: 'info',
          status: 'pass',
        })
      }
    }

    // uninstall.sql 应使用 DROP TABLE IF EXISTS
    if (uninstall?.success) {
      const dropTableCount = (uninstall.content.match(/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?\w+/gi) || []).length
      const dropWithIfExists = (uninstall.content.match(/DROP\s+TABLE\s+IF\s+EXISTS\s+\w+/gi) || []).length
      const plainDrop = dropTableCount - dropWithIfExists
      if (dropTableCount > 0 && plainDrop > 0) {
        items.push({
          id: 'database.uninstall.ifExists',
          category: 'database',
          label: 'DROP TABLE uses IF EXISTS',
          labelZh: 'DROP TABLE 使用 IF EXISTS',
          severity: 'warning',
          status: 'fail',
          detail: `${plainDrop} DROP TABLE without IF EXISTS`,
          detailZh: `${plainDrop} 个 DROP TABLE 未使用 IF EXISTS，重复卸载会报错`,
          fixSuggestion: 'Add IF EXISTS to all DROP TABLE statements',
          fixSuggestionZh: '为所有 DROP TABLE 添加 IF EXISTS',
        })
      } else if (dropTableCount > 0) {
        items.push({
          id: 'database.uninstall.ifExists',
          category: 'database',
          label: 'DROP TABLE uses IF EXISTS',
          labelZh: 'DROP TABLE 使用 IF EXISTS',
          severity: 'info',
          status: 'pass',
        })
      }
    }

    return items
  }

  // ==========================================
  // 检查项：structure（编程式入口文件）
  // ==========================================

  private checkStructure(
    project: ScenarioProject,
    files: Record<string, FileReadResult>,
  ): ChecklistItem[] {
    const items: ChecklistItem[] = []

    // 声明式场景跳过结构检查
    if (project.type !== 'programmatic') {
      items.push({
        id: 'structure.skipped',
        category: 'structure',
        label: 'Declarative scenario (skipped)',
        labelZh: '声明式场景（跳过）',
        severity: 'info',
        status: 'skipped',
        detailZh: '声明式场景无需入口文件',
      })
      return items
    }

    // 编程式必须有 src/index.ts
    const entry = files['src/index.ts']
    if (entry?.success) {
      items.push({
        id: 'structure.entry',
        category: 'structure',
        label: 'src/index.ts exists',
        labelZh: 'src/index.ts 文件存在',
        severity: 'critical',
        status: 'pass',
      })
    } else {
      items.push({
        id: 'structure.entry',
        category: 'structure',
        label: 'src/index.ts missing',
        labelZh: 'src/index.ts 文件缺失',
        severity: 'critical',
        status: 'fail',
        detail: 'File not found',
        detailZh: '编程式场景必须在 src/index.ts 提供默认导出',
        fixSuggestion: 'Create src/index.ts with default export of ScenarioModule',
        fixSuggestionZh: '创建 src/index.ts，默认导出 ScenarioModule 对象',
      })
    }

    return items
  }
}

// ==========================================
// 工具函数
// ==========================================

/** 转义正则特殊字符 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 单例导出 */
export const prePublishChecklistService = new PrePublishChecklistService()
