/**
 * 项目规则服务
 * 支持 BRAND.paths.rules 或 .cursorrules 文件
 * 让用户定义项目级 AI 行为偏好
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { joinPath } from '@shared/toolkit/pathHelper'
import { BRAND } from '@shared/brand'

export interface ProjectRules {
  content: string
  source: string
  lastModified: number
}

class RulesService {
  private cachedRules: ProjectRules | null = null
  private lastCheckTime = 0
  private checkInterval = 5000

  // 支持的规则文件名（按优先级）
  private ruleFiles = [
    BRAND.paths.rules,
    `.${BRAND.cssPrefix}rules`,
    '.cursorrules',
    '.cursor/rules.md',
    'CODING_GUIDELINES.md',
  ]

  /**
   * 获取项目规则
   */
  async getRules(forceRefresh = false): Promise<ProjectRules | null> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return null

    const now = Date.now()
    
    if (!forceRefresh && this.cachedRules && (now - this.lastCheckTime) < this.checkInterval) {
      return this.cachedRules
    }

    this.lastCheckTime = now

    for (const ruleFile of this.ruleFiles) {
      const fullPath = joinPath(workspacePath, ruleFile)
      const content = await api.file.read(fullPath)
      
      if (content !== null) {
        this.cachedRules = {
          content: content.trim(),
          source: ruleFile,
          lastModified: now,
        }
        logger.agent.info(`[RulesService] Loaded rules from: ${ruleFile}`)
        return this.cachedRules
      }
    }

    this.cachedRules = null
    return null
  }

  /**
   * 保存规则到文件
   */
  async saveRules(content: string): Promise<boolean> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return false

    // 确保 BRAND.dirName 目录存在
    const aweeclawDir = joinPath(workspacePath, BRAND.dirName)
    await api.file.mkdir(aweeclawDir)

    const rulesPath = joinPath(workspacePath, BRAND.paths.rules)
    const success = await api.file.write(rulesPath, content)
    
    if (success) {
      this.cachedRules = {
        content: content.trim(),
        source: BRAND.paths.rules,
        lastModified: Date.now(),
      }
    }

    return success
  }

  /**
   * 获取默认规则模板
   *
   * 设计原则：
   * - 不预设具体技术栈，让用户根据项目实际情况填写
   * - 覆盖通用维度：项目背景、工作范围、输出规范、沟通风格、协作约定
   * - 注释引导用户按需保留或删除条目，避免模板过度约束
   */
  getDefaultRulesTemplate(): string {
    return `# Project Rules

> 本文件用于定义 Agent 在当前项目中的行为规范。
> 请根据实际项目类型（前端 / 后端 / 数据 / 文档 / 设计 …）保留或删除以下条目。
> 行业最佳实践：保持简洁、分组清晰、可执行，避免空泛口号。

## 1. 项目背景
- 项目名称：（示例：AweeClaw 客户端）
- 项目类型：（示例：Electron + React 桌面应用）
- 主要技术栈：（示例：TypeScript / React / Zustand / Tailwind）
- 目标用户：（示例：开发者与终端用户混合）

## 2. 工作范围与边界
- 仅在用户当前请求范围内行动，不主动扩大改动
- 涉及破坏性操作（删除、覆盖、批量重构）前必须先说明计划
- 不确定时主动提问，不基于猜测执行
- 优先复用现有实现，避免重复造轮子

## 3. 输出规范
- 回答使用与用户提问一致的语言
- 代码改动需可独立审查：最小化 diff、保留原有业务逻辑
- 涉及多文件改动时，先说明改动顺序与依赖关系
- 长输出按章节/步骤组织，便于快速定位

## 4. 沟通风格
- 直接、简洁，避免无信息量的开场与总结
- 给出结论先行，再补充必要依据
- 不确定的内容明确标注，不与确定内容混为一谈
- 用户表达模糊时主动澄清，而非自行假设

## 5. 通用约定
- 命名语义化，避免无意义缩写
- 单一职责：函数 / 模块 / 文件保持聚焦
- 错误处理在系统边界（用户输入、外部 API）进行，内部信任已有约束
- 注释只写"为什么"，不写"是什么"
- 不引入未使用的依赖与未调用的代码

## 6. 项目结构（按需填写）
- 入口：（示例：src/main / src/renderer）
- 模块划分：（示例：components / state / intelligence / adapters）
- 测试位置：（示例：__tests__ 同级目录）
`
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedRules = null
    this.lastCheckTime = 0
  }
}

export const rulesService = new RulesService()
