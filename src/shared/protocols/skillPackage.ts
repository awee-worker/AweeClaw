/**
 * SkillPackage System - 技能包系统
 *
 * 升级现有 Skill 系统为 SkillPackage，支持：
 * - 技能包：多个相关 Skill 的集合
 * - 依赖声明：技能包可以依赖其他技能包或 ToolPack
 * - 版本管理：语义化版本控制
 * - 场景绑定：技能包可以声明适用的场景
 * - 市场分发：支持从市场安装和更新
 *
 * 向后兼容：现有 SKILL.md 格式自动升级为单技能包
 */

// ============================================
// SkillPackage 类型定义
// ============================================

export interface SkillPackageManifest {
  id: string
  name: string
  nameZh: string
  version: string
  description: string
  descriptionZh: string
  author: string
  license?: string
  homepage?: string
  repository?: string
  category: SkillPackageCategory
  tags: string[]
  icon?: string

  skills: SkillDefinition[]
  dependencies?: SkillPackageDependency[]
  compatibleScenarios?: string[]
  incompatibleScenarios?: string[]
  requiredToolPacks?: string[]

  config?: SkillPackageConfigSchema
}

export type SkillPackageCategory =
  | 'coding'
  | 'data'
  | 'creative'
  | 'productivity'
  | 'automation'
  | 'integration'
  | 'custom'

export interface SkillDefinition {
  id: string
  name: string
  description: string
  triggerType: 'auto' | 'manual' | 'keyword'
  keywords?: string[]
  content: string
  priority?: number
}

export interface SkillPackageDependency {
  id: string
  version?: string
  source?: 'builtin' | 'marketplace' | 'git'
}

export interface SkillPackageConfigSchema {
  properties: Record<string, SkillPackageConfigProperty>
  required?: string[]
}

export interface SkillPackageConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'select'
  description: string
  default?: unknown
  enum?: string[]
}

// ============================================
// 已安装的 SkillPackage
// ============================================

export interface InstalledSkillPackage {
  manifest: SkillPackageManifest
  installPath: string
  installedAt: number
  updatedAt: number
  source: 'builtin' | 'marketplace' | 'git' | 'local'
  enabled: boolean
  config?: Record<string, unknown>
}

// ============================================
// SkillPackage 注册表
// ============================================

class SkillPackageRegistryClass {
  private packages = new Map<string, InstalledSkillPackage>()

  register(pkg: InstalledSkillPackage): void {
    this.packages.set(pkg.manifest.id, pkg)
  }

  unregister(packageId: string): boolean {
    return this.packages.delete(packageId)
  }

  get(packageId: string): InstalledSkillPackage | undefined {
    return this.packages.get(packageId)
  }

  getAll(): InstalledSkillPackage[] {
    return Array.from(this.packages.values())
  }

  getEnabled(): InstalledSkillPackage[] {
    return this.getAll().filter(p => p.enabled)
  }

  getByScenario(scenarioId: string): InstalledSkillPackage[] {
    return this.getEnabled().filter(pkg => {
      const { compatibleScenarios, incompatibleScenarios } = pkg.manifest
      if (incompatibleScenarios?.includes(scenarioId)) return false
      if (!compatibleScenarios || compatibleScenarios.length === 0) return true
      return compatibleScenarios.includes(scenarioId)
    })
  }

  getByCategory(category: SkillPackageCategory): InstalledSkillPackage[] {
    return this.getAll().filter(p => p.manifest.category === category)
  }

  setEnabled(packageId: string, enabled: boolean): boolean {
    const pkg = this.packages.get(packageId)
    if (!pkg) return false
    pkg.enabled = enabled
    return true
  }

  has(packageId: string): boolean {
    return this.packages.has(packageId)
  }

  /**
   * 解析所有技能包的依赖，返回拓扑排序的安装顺序
   */
  resolveDependencyOrder(): string[] {
    const visited = new Set<string>()
    const result: string[] = []

    const visit = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)

      const pkg = this.packages.get(id)
      if (pkg?.manifest.dependencies) {
        for (const dep of pkg.manifest.dependencies) {
          if (this.packages.has(dep.id)) {
            visit(dep.id)
          }
        }
      }

      result.push(id)
    }

    for (const id of this.packages.keys()) {
      visit(id)
    }

    return result
  }

  /**
   * 获取当前场景下所有可用的 Skill 定义
   */
  getAvailableSkills(scenarioId?: string): SkillDefinition[] {
    const packages = scenarioId
      ? this.getByScenario(scenarioId)
      : this.getEnabled()

    return packages.flatMap(pkg => pkg.manifest.skills)
  }
}

export const skillPackageRegistry = new SkillPackageRegistryClass()

// ============================================
// SKILL.md 到 SkillPackage 的转换器
// ============================================

export function convertSkillMdToPackage(
  name: string,
  description: string,
  content: string,
  filePath: string,
  triggerType: 'auto' | 'manual',
  source: 'global' | 'project'
): InstalledSkillPackage {
  const manifest: SkillPackageManifest = {
    id: `skill-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    nameZh: name,
    version: '1.0.0',
    description,
    descriptionZh: description,
    author: 'unknown',
    category: 'custom',
    tags: [],
    skills: [{
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      description,
      triggerType,
      content,
    }],
  }

  return {
    manifest,
    installPath: filePath,
    installedAt: Date.now(),
    updatedAt: Date.now(),
    source: source === 'global' ? 'builtin' : 'local',
    enabled: true,
  }
}
