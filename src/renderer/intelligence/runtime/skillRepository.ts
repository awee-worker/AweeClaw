/**
 * Skill 服务
 * 
 * 基于 agentskills.io 标准实现 Skill 系统
 * 扫描 BRAND.paths.skills 目录下的 SKILL.md 文件
 * 支持从 skills.sh 市场安装和 GitHub 克隆安装
 */

import { api } from '../../adapters/electronBridge'
import { browsePlugins, getPluginSkillContributions } from '../../adapters/pluginService'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { useSceneModeStore } from '@/renderer/modes/sceneModeStore'
import type { SceneMode } from '@protocols/sceneModeProtocol'

import { joinPath, platform } from '@shared/toolkit/pathHelper'
import { parse as parseYaml } from 'yaml'
import { BRAND } from '@shared/brand'
import type { CapabilityGap } from '@intelligence/capabilities/planning/capabilityGapDetector'
import { buildSkillManifest } from './skillManifestBudget'

/** 技能清单注入的 token 预算：超出即折叠，避免清单挤占技能完整内容的加载空间 */
const SKILL_MANIFEST_BUDGET_TOKENS = 1800

// ============================================
// 类型定义
// ============================================

/** Skill 触发模式 */
export type SkillTriggerType = 'auto' | 'manual'

/** Skill 来源层级 */
export type SkillSource = 'global' | 'project' | 'bundled' | 'plugin'

export interface SkillItem {
    name: string
    description: string
    content: string       // SKILL.md body（去掉 frontmatter）
    filePath: string
    enabled: boolean
    /** 是否在空会话技能列表展示；与 enabled 独立，仅影响展示不影响 AI 调用 */
    visible: boolean
    license?: string
    metadata?: Record<string, string>
    /** 触发模式：auto LLM 自动选择（默认）, manual 手动 @mention */
    type: SkillTriggerType
    /** 来源层级：bundled 内置（最低优先级）, global 全局, project 工作区级 */
    source: SkillSource
    /** 触发关键词：用于智能匹配用户消息，自动注入完整 Skill 内容 */
    keywords?: string[]
    /** 生效的场景模式（逗号分隔的多模式）；为空表示所有模式可见 */
    sceneMode?: string
    /** 二级选项：选中后在输入框自动填入 prompt（如「网站开发」下的细分场景） */
    subSkills?: SubSkillItem[]
}

/** 技能二级选项 */
export interface SubSkillItem {
    /** 显示文本（中文） */
    label: string
    /** 显示文本（英文，可选） */
    labelEn?: string
    /** 点击后填入输入框的需求提示词（中文） */
    prompt: string
    /** 英文需求提示词（可选，英文界面使用） */
    promptEn?: string
}

/**
 * 判断技能在当前场景模式下是否可见
 *
 * 未声明场景归属的技能对所有模式可见（向后兼容）；
 * 声明多个模式时按逗号分隔逐项匹配。
 */
export function isSkillVisibleInScene(
    skill: Pick<SkillItem, 'sceneMode'>,
    sceneMode: SceneMode,
): boolean {
    if (!skill.sceneMode) return true
    return skill.sceneMode.split(',').map(m => m.trim()).filter(Boolean).includes(sceneMode)
}

interface SkillConfig {
    disabled: string[]    // 禁用的 Skill 名称列表（影响 AI 可否调用）
    /** 不在空会话技能列表展示的技能名；仅影响展示，不影响 AI 调用 */
    hidden?: string[]
    /** UI 中覆盖的触发模式配置（优先于 SKILL.md frontmatter） */
    typeOverrides?: Record<string, SkillTriggerType>
    /** UI 中覆盖的场景归属配置（逗号分隔的多模式，优先于 SKILL.md frontmatter） */
    sceneModeOverrides?: Record<string, string>
}


interface MarketplaceResult {
    name: string
    package: string       // owner/repo@skill-name
    installs: number
    url: string
}

/** 能力缺口对应的市场候选 */
export interface MarketplaceSuggestion extends MarketplaceResult {
    /** 命中的能力关键词，用于向用户解释为何推荐 */
    matchedKeywords: string[]
    /** 相关度 0~1，按命中关键词占比计算 */
    relevance: number
}

/** 技能市场检索结果（按技能名查找可安装来源） */
export interface SkillMarketMatch {
    /** 来源渠道：backend 后端插件市场（type=skill）, skills.sh 公共技能市场 */
    source: 'backend' | 'skills.sh'
    /** 展示名 */
    name: string
    /** 安装标识：backend 为 pluginKey，skills.sh 为 owner/repo@skill */
    identifier: string
    description: string
    installs: number
}

// ============================================
// YAML Frontmatter 解析
// ============================================

function parseSkillMd(raw: string): { frontmatter: Record<string, unknown>; body: string } | null {
    const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/)
    if (!match) return null

    const frontmatterRaw = match[1]
    const body = match[2].trim()

    let frontmatter: Record<string, unknown> = {}
    try {
        frontmatter = parseYaml(frontmatterRaw) || {}
    } catch (e) {
        logger.agent.warn('[SkillService] Failed to parse YAML frontmatter:', e)
        return null
    }

    return { frontmatter, body }
}

// ============================================
// 名称归一化与相似度
// ============================================

/** 技能名归一化：忽略大小写与 - _ . 空格 等分隔符差异 */
function normalizeSkillName(name: string): string {
    return String(name || '').toLowerCase().replace(/[\s\-_.]+/g, '')
}

/** 技能名分词：按分隔符切分，用于词元重合度比较 */
function tokenizeSkillName(name: string): string[] {
    return String(name || '').toLowerCase().split(/[\s\-_.]+/).filter(token => token.length > 1)
}

/** 编辑距离：用于评估两个技能名的字形接近程度 */
function levenshtein(a: string, b: string): number {
    if (a === b) return 0
    if (!a.length) return b.length
    if (!b.length) return a.length

    let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        const current: number[] = [i]
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            current[j] = Math.min(current[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
        }
        prev = current
    }
    return prev[b.length]
}

// ============================================
// 技能变更通知
// ============================================

/**
 * 技能变更订阅者
 *
 * 技能启用状态、来源（如已安装插件）变化后广播，让正在展示技能列表的界面
 * （新建任务界面的技能条）无需等缓存过期即可刷新。
 */
const skillChangeListeners = new Set<() => void>()

/** 订阅技能变更，返回取消订阅函数 */
export function subscribeSkillsChanged(listener: () => void): () => void {
    skillChangeListeners.add(listener)
    return () => { skillChangeListeners.delete(listener) }
}

/** 广播技能变更 */
export function notifySkillsChanged(): void {
    skillChangeListeners.forEach(listener => listener())
}

// ============================================
// Skill 服务
// ============================================

class SkillService {
    private cache: SkillItem[] | null = null
    private configCache: SkillConfig | null = null
    private lastScanTime = 0
    private readonly SCAN_INTERVAL = 5000 // 5 秒缓存
    private readonly SKILLS_DIR = BRAND.paths.skills
    /** 技能配置文件名：机器级，落在全局技能目录下，与工作区解耦 */
    private readonly CONFIG_FILE = BRAND.paths.skillsConfig
    /** 旧版工作区级配置位置，仅用于首次迁移读取 */
    private readonly LEGACY_CONFIG_FILE = BRAND.paths.skillsConfigLegacy
    /** 已解析的全局配置绝对路径（进程内缓存，避免重复 IPC） */
    private configPathCache: string | null = null

    /**
     * 获取所有已启用的 Skills
     */
    async getSkills(): Promise<SkillItem[]> {
        const all = await this.getAllSkills()
        const { currentSceneMode } = useSceneModeStore.getState()
        return all.filter(s => s.enabled && isSkillVisibleInScene(s, currentSceneMode))
    }

    /**
     * 获取空会话技能列表应展示的 Skills
     *
     * 在可调用集合上再要求 visible：隐藏只影响列表展示，不改变可调用性。
     */
    async getVisibleSkills(): Promise<SkillItem[]> {
        const all = await this.getAllSkills()
        const { currentSceneMode } = useSceneModeStore.getState()
        return all.filter(s => s.enabled && s.visible && isSkillVisibleInScene(s, currentSceneMode))
    }


    /**
     * 获取所有 Skills（包括禁用的）
     * 三层扫描，优先级由低到高：
     *   内置 (resources/skills) → 全局 ({userData}/skills/) → 工作区 (BRAND.paths.skills)
     * 同名技能后扫描的覆盖先扫描的
     */
    async getAllSkills(forceRefresh = false): Promise<SkillItem[]> {
        const now = Date.now()
        if (!forceRefresh && this.cache && (now - this.lastScanTime) < this.SCAN_INTERVAL) {
            return this.cache
        }

        const config = await this.loadConfig()
        const skillMap = new Map<string, SkillItem>()

        // 1. 扫描内置 Skills（最低优先级，随客户端分发）
        try {
            const bundledDir = await api.skills.getBundledDir()
            if (bundledDir) {
                await this.scanSkillsDir(bundledDir, 'bundled', config, skillMap)
            }
        } catch {
            // 内置目录不可用时静默跳过
        }

        // 2. 扫描全局 Skills
        try {
            const globalDir = await api.skills.getGlobalDir()
            if (globalDir) {
                await this.scanSkillsDir(globalDir, 'global', config, skillMap)
            }
        } catch {
            // 全局目录不可用时静默跳过
        }

        // 3. 扫描已安装 skill 型插件的技能
        //    这类 SKILL.md 位于插件目录，安装时只注册到后端，不写入本地技能目录，
        //    因此需要单独并入；插件被禁用时跳过其对应技能。
        try {
            const contributions = await getPluginSkillContributions()
            for (const contribution of contributions) {
                if (!contribution.pluginEnabled) continue

                // 技能正文缺失：插件声明为 skill 型，本地却没有 SKILL.md（历史上按 configOnly
                // 安装的纯 skill 插件只落地了 manifest.json）。显式跳过并留痕，不再静默丢弃。
                if (contribution.skillMdMissing) {
                    logger.agent.warn(
                        `[SkillService] Plugin "${contribution.pluginKey}" is missing SKILL.md; skill skipped`,
                    )
                    continue
                }

                const raw = await api.file.read(contribution.skillMdPath)
                if (!raw) continue

                const parsed = parseSkillMd(raw)
                if (!parsed) {
                    logger.agent.warn(`[SkillService] Invalid SKILL.md format: ${contribution.skillMdPath}`)
                    continue
                }

                const skill = this.buildSkillItem(contribution.skillName, contribution.skillMdPath, 'plugin', parsed, config)
                if (!skill) continue

                // SKILL.md frontmatter 不含 nameZh，中文界面会因缺少该字段回退成英文技能名；
                // 插件 manifest 声明的中英文名与图标一并合入 metadata，由技能条优先取用，
                // 使插件技能在列表里展示与插件本身一致的图标。
                const pluginMeta: Record<string, string> = {}
                if (contribution.nameZh) pluginMeta.nameZh = contribution.nameZh
                if (contribution.nameEn) pluginMeta.nameEn = contribution.nameEn
                if (contribution.icon) pluginMeta.icon = contribution.icon
                if (Object.keys(pluginMeta).length > 0) {
                    skill.metadata = { ...(skill.metadata || {}), ...pluginMeta }
                }

                // 插件级「在新建任务界面显示」开关只控制技能列表展示，不影响 AI 调用
                if (contribution.newTaskVisible === false) {
                    skill.visible = false
                }

                skillMap.set(skill.name, skill)
            }
        } catch (err) {
            // 插件技能读取失败不影响本地技能加载
            logger.agent.warn('[SkillService] Failed to load plugin skills:', err)
        }

        // 4. 扫描工作区 Skills（覆盖全局、插件与内置同名）
        const { workspacePath } = useStore.getState()
        if (workspacePath) {
            const projectDir = joinPath(workspacePath, this.SKILLS_DIR)
            await this.scanSkillsDir(projectDir, 'project', config, skillMap)
        }

        const skills = Array.from(skillMap.values())

        this.cache = skills
        this.lastScanTime = now
        logger.agent.info(`[SkillService] Loaded ${skills.length} skills`)
        return skills
    }


    /**
     * 扫描指定目录下的 Skills
     */
    private async scanSkillsDir(
        skillsDir: string,
        source: SkillSource,
        config: SkillConfig,
        skillMap: Map<string, SkillItem>
    ): Promise<void> {
        let items: any[] | null
        try {
            items = await api.file.readDir(skillsDir)
        } catch {
            return
        }
        if (!items) return

        for (const item of items) {
            if (!item.isDirectory || item.name.startsWith('.')) continue

            const skillMdPath = joinPath(skillsDir, item.name, 'SKILL.md')
            const raw = await api.file.read(skillMdPath)
            if (!raw) continue

            const parsed = parseSkillMd(raw)
            if (!parsed) {
                logger.agent.warn(`[SkillService] Invalid SKILL.md format: ${item.name}`)
                continue
            }

            const skill = this.buildSkillItem(item.name, skillMdPath, source, parsed, config)
            if (!skill) {
                logger.agent.warn(`[SkillService] Missing name or description: ${item.name}`)
                continue
            }

            skillMap.set(skill.name, skill)
        }
    }

    /**
     * 由 SKILL.md 的解析结果构造技能条目
     *
     * 目录扫描与插件技能共用同一套 frontmatter 解析与配置覆盖规则，
     * 保证两类来源的技能在启用状态、场景归属、触发模式上行为一致：
     * 技能名与描述取自 frontmatter，缺失时回退到调用方提供的名称。
     */
    private buildSkillItem(
        fallbackName: string,
        filePath: string,
        source: SkillSource,
        parsed: { frontmatter: Record<string, unknown>; body: string },
        config: SkillConfig
    ): SkillItem | null {
        const { frontmatter, body } = parsed
        const name = (frontmatter.name as string) || fallbackName
        const description = (frontmatter.description as string) || ''

        if (!name || !description) return null

        const triggerType = (config.typeOverrides?.[name] as SkillTriggerType)
            || (frontmatter.type as SkillTriggerType)
            || 'auto'

        const keywords = Array.isArray(frontmatter.keywords)
            ? frontmatter.keywords.filter((k): k is string => typeof k === 'string')
            : []

        // 二级选项：label 与 prompt 都非空才保留
        const subSkills: SubSkillItem[] = Array.isArray(frontmatter.subSkills)
            ? (frontmatter.subSkills as Array<Record<string, unknown>>)
                .map(item => ({
                    label: typeof item?.label === 'string' ? item.label.trim() : '',
                    labelEn: typeof item?.labelEn === 'string' ? item.labelEn : undefined,
                    prompt: typeof item?.prompt === 'string' ? item.prompt.trim() : '',
                    promptEn: typeof item?.promptEn === 'string' ? item.promptEn : undefined,
                }))
                .filter(item => item.label && item.prompt)
            : []

        // 场景归属：frontmatter 顶层 sceneMode 优先，兼容 metadata.sceneMode；
        // 技能列表中的调整写入配置覆盖，优先级最高（内置技能目录只读，只能靠覆盖调整）
        const declaredSceneMode = typeof frontmatter.sceneMode === 'string'
            ? frontmatter.sceneMode
            : (frontmatter.metadata as Record<string, string> | undefined)?.sceneMode

        const sceneMode = config.sceneModeOverrides?.[name] || declaredSceneMode || ''

        const metadata: Record<string, string> = {
            ...(frontmatter.metadata as Record<string, string> | undefined),
        }
        // 图标：frontmatter 顶层 icon 优先，兼容 metadata.icon；技能条按 metadata.icon 渲染
        const declaredIcon = (typeof frontmatter.icon === 'string' ? frontmatter.icon : undefined)
            || metadata.icon
        if (declaredIcon) metadata.icon = declaredIcon
        if (sceneMode) metadata.sceneMode = sceneMode

        return {
            name,
            description,
            content: body,
            filePath,
            // 内置技能随客户端分发，始终启用，不受用户禁用列表影响
            enabled: source === 'bundled' ? true : !config.disabled.includes(name),
            visible: !(config.hidden ?? []).includes(name),

            license: frontmatter.license as string | undefined,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
            type: triggerType,
            source,
            keywords,
            sceneMode: sceneMode || undefined,
            subSkills: subSkills.length > 0 ? subSkills : undefined,
        }
    }

    /**
     * 从 skills.sh 市场搜索 Skills（使用 REST API）
     */
    async searchMarketplace(query: string): Promise<MarketplaceResult[]> {
        try {
            const result = await api.http.readUrl(
                `https://skills.sh/api/search?q=${encodeURIComponent(query)}`,
                15000
            )

            if (!result.success || !result.content) return []

            const data = JSON.parse(result.content) as {
                skills?: Array<{
                    name: string
                    source: string
                    installs: number
                    skillId: string
                }>
            }

            if (!data.skills?.length) return []

            return data.skills.map(s => ({
                name: s.name,
                package: `${s.source}@${s.skillId}`,
                installs: s.installs,
                url: `https://skills.sh/${s.source}/${s.skillId}`,
            }))
        } catch (err) {
            logger.agent.error('[SkillService] Marketplace search failed:', err)
            return []
        }
    }

    /**
     * 按能力缺口检索技能市场候选
     *
     * 只做检索与排序，不安装：安装必须由用户点击确认，不存在自动安装路径。
     */
    async suggestSkillsForGap(gap: CapabilityGap, limit = 3): Promise<MarketplaceSuggestion[]> {
        const query = gap.keywords.slice(0, 3).join(' ').trim()
        if (!query) return []

        const results = await this.searchMarketplace(query)
        if (results.length === 0) return []

        return results
            .map((result) => {
                const text = `${result.name} ${result.package}`.toLowerCase()
                const matchedKeywords = gap.keywords.filter((keyword) => text.includes(keyword.toLowerCase()))
                return {
                    ...result,
                    matchedKeywords,
                    relevance: gap.keywords.length > 0
                        ? matchedKeywords.length / gap.keywords.length
                        : 0,
                }
            })
            .sort((a, b) => b.relevance - a.relevance || b.installs - a.installs)
            .slice(0, Math.max(1, limit))
    }

    /**
     * 从 skills.sh 安装 Skill（标准 Claude Code 流程）
     * 1. 克隆仓库到临时目录
     * 2. 在仓库中找到包含 SKILL.md 的技能目录
     * 3. 仅提取该技能目录（解引用符号链接为真实文件）到 BRAND.paths.skills/[skillId]
     * 4. 清理临时克隆
     */
    async installFromMarketplace(packageId: string, level: SkillSource = 'project'): Promise<{ success: boolean; error?: string }> {
        const atIdx = packageId.indexOf('@')
        if (atIdx === -1) return { success: false, error: 'Invalid package format' }
        const repo = packageId.substring(0, atIdx)
        const skillId = packageId.substring(atIdx + 1)
        if (!repo || !skillId) return { success: false, error: 'Invalid package format' }

        return this.installFromGitRepo(`https://github.com/${repo}.git`, skillId, level)
    }

    /**
     * 从 GitHub URL 安装 Skill（标准 Claude Code 流程）
     */
    async installFromGitHub(url: string, level: SkillSource = 'project'): Promise<{ success: boolean; error?: string }> {
        const repoName = url.replace(/\.git$/, '').split('/').pop()
        if (!repoName) return { success: false, error: 'Invalid GitHub URL' }
        return this.installFromGitRepo(url, repoName, level)
    }

    /**
     * 通用 Git 仓库安装逻辑
     */
    private async installFromGitRepo(url: string, skillId: string, level: SkillSource = 'project'): Promise<{ success: boolean; error?: string }> {
        if (!/^https:\/\//.test(url) || /[$`;&|\n\r]/.test(url)) {
            return { success: false, error: 'Invalid or unsafe URL' }
        }

        const { workspacePath } = useStore.getState()

        let skillsDir: string
        let cwd: string
        if (level === 'global') {
            try {
                skillsDir = await api.skills.getGlobalDir()
            } catch {
                return { success: false, error: 'Failed to get global skills directory' }
            }
            cwd = workspacePath || skillsDir
        } else {
            if (!workspacePath) return { success: false, error: 'No workspace open' }
            skillsDir = joinPath(workspacePath, this.SKILLS_DIR)
            cwd = workspacePath
        }
        await api.file.mkdir(skillsDir)

        const targetDir = joinPath(skillsDir, skillId)
        const tmpDir = joinPath(skillsDir, `.tmp-clone-${skillId}-${Date.now()}`)

        try {
            // 1. 克隆仓库到临时目录
            const cloneResult = await api.shell.executeBackground({
                command: `git clone -c core.symlinks=true --depth 1 "${url}" "${tmpDir}"`,
                cwd: cwd,
                timeout: 60000,
            })

            if (cloneResult.exitCode !== 0 || cloneResult.error) {
                await api.file.delete(tmpDir)
                return { success: false, error: cloneResult.error || cloneResult.output || 'Clone failed' }
            }

            // 2. 在仓库中定位包含 SKILL.md 的技能目录
            const candidateDirs = [
                `.claude/skills/${skillId}`,
                `skills/${skillId}`,
                skillId,
                '',
            ]

            let foundDir: string | null = null
            for (const dir of candidateDirs) {
                const checkPath = joinPath(tmpDir, dir, 'SKILL.md')
                const exists = await api.file.exists(checkPath)
                if (exists) {
                    foundDir = dir ? joinPath(tmpDir, dir) : tmpDir
                    break
                }
            }

            if (!foundDir) {
                await api.file.delete(tmpDir)
                return { success: false, error: `Could not find SKILL.md for skill '${skillId}'` }
            }

            // 3. 仅提取技能目录到 targetDir
            await api.file.delete(targetDir)
            if (foundDir === tmpDir) {
                await api.file.delete(joinPath(tmpDir, '.git'))
                await api.file.rename(tmpDir, targetDir)
            } else {
                await api.file.mkdir(targetDir)
                const copyCommand = platform.isWindows
                    ? `robocopy "${foundDir}" "${targetDir}" /E /NFL /NDL /NJH /NJS /NP`
                    : `cp -rL "${foundDir}/." "${targetDir}"`
                const copyResult = await api.shell.executeBackground({
                    command: copyCommand,
                    cwd: cwd,
                    timeout: 30000,
                })
                const copyFailed = platform.isWindows
                    ? (copyResult.exitCode !== undefined && copyResult.exitCode >= 8)
                    : (copyResult.exitCode !== 0)
                if (copyFailed) {
                    await api.file.delete(targetDir)
                    await api.file.delete(tmpDir)
                    return { success: false, error: `Failed to copy skill directory: ${copyResult.error || copyResult.output}` }
                }
                await api.file.delete(tmpDir)
            }

            this.clearCache()
            return { success: true }
        } catch (err) {
            await api.file.delete(tmpDir)
            const msg = err instanceof Error ? err.message : String(err)
            return { success: false, error: msg }
        }
    }

    /**
     * 创建新 Skill
     * @param level 保存层级：'project' 保存到工作区目录，'global' 保存到全局目录
     * @param sceneMode 场景归属（逗号分隔的多模式），为空表示所有模式可见
     */
    async createSkill(name: string, description = '', level: SkillSource = 'project', sceneMode = ''): Promise<{ success: boolean; filePath?: string; error?: string }> {
        // 验证名称格式
        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
            return { success: false, error: 'Name must be lowercase alphanumeric with hyphens (e.g. my-skill)' }
        }

        // 内置技能目录只读，不允许写入
        if (level === 'bundled') {
            return { success: false, error: 'Built-in skills are read-only' }
        }

        let baseDir: string

        if (level === 'global') {
            try {
                baseDir = await api.skills.getGlobalDir()
            } catch {
                return { success: false, error: 'Failed to get global skills directory' }
            }
        } else {
            const { workspacePath } = useStore.getState()
            if (!workspacePath) return { success: false, error: 'No workspace open' }
            baseDir = joinPath(workspacePath, this.SKILLS_DIR)
        }

        const skillDir = joinPath(baseDir, name)
        const skillMdPath = joinPath(skillDir, 'SKILL.md')

        // 检查是否已存在
        const existing = await api.file.read(skillMdPath)
        if (existing !== null) {
            return { success: false, error: `Skill "${name}" already exists` }
        }

        await api.file.mkdir(skillDir)

        // 场景归属写入 frontmatter，后续可在技能列表中调整
        const sceneLine = sceneMode.trim() ? `sceneMode: ${sceneMode.trim()}\n` : ''
        const template = `---
name: ${name}
description: ${description || 'Describe what this skill does and when to use it.'}
${sceneLine}---

## Instructions

Add your skill instructions here.
`


        const success = await api.file.write(skillMdPath, template)
        if (!success) return { success: false, error: 'Failed to write SKILL.md' }

        this.clearCache()
        return { success: true, filePath: skillMdPath }
    }

    /**
     * 删除 Skill
     * @param level 指定从哪个层级删除，默认 'project'
     */
    async deleteSkill(name: string, level: SkillSource = 'project'): Promise<boolean> {
        // 内置技能随客户端分发，不可删除
        if (level === 'bundled') return false

        let baseDir: string
        if (level === 'global') {
            try {
                baseDir = await api.skills.getGlobalDir()
            } catch {
                return false
            }
        } else {
            const { workspacePath } = useStore.getState()
            if (!workspacePath) return false
            baseDir = joinPath(workspacePath, this.SKILLS_DIR)
        }

        const skillDir = joinPath(baseDir, name)
        const success = await api.file.delete(skillDir)

        if (success) {
            // 从禁用列表与场景归属覆盖中一并移除
            const config = await this.loadConfig()
            config.disabled = config.disabled.filter(n => n !== name)
            if (config.hidden) config.hidden = config.hidden.filter(n => n !== name)
            if (config.sceneModeOverrides) delete config.sceneModeOverrides[name]
            await this.saveConfig(config)
            this.clearCache()
        }

        return success
    }


    /**
     * 切换 Skill 启用/禁用
     *
     * 决定该技能能否被 AI 调用；内置技能随客户端分发，不可停用。
     */
    async toggleSkill(name: string, enabled: boolean): Promise<boolean> {
        // 内置技能随客户端分发，不可停用
        if (!enabled) {
            const target = (await this.getAllSkills()).find(s => s.name === name)
            if (target?.source === 'bundled') return false
        }

        const config = await this.loadConfig()

        if (enabled) {
            config.disabled = config.disabled.filter(n => n !== name)
        } else {
            if (!config.disabled.includes(name)) {
                config.disabled.push(name)
            }
        }

        await this.saveConfig(config)

        // 更新缓存
        if (this.cache) {
            const skill = this.cache.find(s => s.name === name)
            if (skill) skill.enabled = enabled
        }

        notifySkillsChanged()
        return true
    }

    /**
     * 切换 Skill 的列表展示状态
     *
     * 与启用/停用相互独立：只决定是否出现在空会话技能列表，不影响 AI 调用。
     * @param visible true 展示，false 隐藏
     */
    async toggleSkillVisible(name: string, visible: boolean): Promise<boolean> {
        const config = await this.loadConfig()
        if (!config.hidden) config.hidden = []

        if (visible) {
            config.hidden = config.hidden.filter(n => n !== name)
        } else if (!config.hidden.includes(name)) {
            config.hidden.push(name)
        }

        await this.saveConfig(config)

        // 更新缓存
        if (this.cache) {
            const skill = this.cache.find(s => s.name === name)
            if (skill) skill.visible = visible
        }

        notifySkillsChanged()
        return true
    }


    /**
     * 按名称获取单个 Skill（用于 apply_skill 工具按需加载）
     */
    async getSkillByName(name: string): Promise<SkillItem | null> {
        const skills = await this.getSkills()
        return skills.find(s => s.name.toLowerCase() === name.toLowerCase() && s.enabled) || null
    }

    /**
     * 查找与给定名称最接近的已安装技能
     *
     * 技能名由模型生成，大小写、连字符/下划线、单复数、前缀等细微差异都会导致精确匹配失败。
     * 这里做一次归一化 + 词元重合 + 编辑距离的兜底，避免把「模型轻微写错名字」
     * 直接变成一次无意义的调用失败。
     */
    async findSimilarSkills(name: string, limit = 3): Promise<Array<{ skill: SkillItem; score: number }>> {
        const target = normalizeSkillName(name)
        if (!target) return []

        const targetTokens = tokenizeSkillName(name)
        const scored: Array<{ skill: SkillItem; score: number }> = []

        for (const skill of await this.getSkills()) {
            const candidate = normalizeSkillName(skill.name)
            if (!candidate) continue

            let score = 1 - levenshtein(target, candidate) / Math.max(target.length, candidate.length)

            // 互相包含（缺少前缀/后缀）时给较高分
            if (candidate.includes(target) || target.includes(candidate)) {
                score = Math.max(score, 0.85)
            }

            // 词元重合（例如 work-report 与 report）
            const shared = targetTokens.filter(token => tokenizeSkillName(skill.name).includes(token)).length
            if (shared > 0 && targetTokens.length > 0) {
                score = Math.max(score, 0.6 + 0.3 * (shared / targetTokens.length))
            }

            if (score >= 0.5) scored.push({ skill, score })
        }

        return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit))
    }

    /**
     * 解释「技能存在但当前加载不了」的原因
     *
     * getSkillByName 只返回当前可用的技能，被禁用或被场景模式过滤掉的技能会落到降级分支。
     * 此时需要给出准确原因（禁用 / 当前模式不可用），而不是笼统地告诉模型「不存在」。
     */
    async explainUnavailableSkill(name: string): Promise<{ skill: SkillItem; reason: 'disabled' | 'scene-mode' } | null> {
        const target = normalizeSkillName(name)
        if (!target) return null

        const hit = (await this.getAllSkills()).find(s => normalizeSkillName(s.name) === target)
        if (!hit) return null
        if (!hit.enabled) return { skill: hit, reason: 'disabled' }

        const { currentSceneMode } = useSceneModeStore.getState()
        if (!isSkillVisibleInScene(hit, currentSceneMode)) {
            return { skill: hit, reason: 'scene-mode' }
        }

        return null
    }

    /**
     * 在技能/插件市场按名称检索可安装的技能
     *
     * 数据源优先级：
     *   1. 后端插件市场（type=skill）—— 已发布技能的主渠道，需登录
     *   2. skills.sh 公共市场 —— 未登录或后端无结果时的兜底
     * 只做检索，不安装：安装必须由用户确认。
     */
    async searchSkillMarket(name: string, limit = 3): Promise<SkillMarketMatch[]> {
        const keyword = String(name || '').trim()
        if (!keyword) return []

        const matches: SkillMarketMatch[] = []

        try {
            const result = await browsePlugins({ type: 'skill', search: keyword, limit })
            for (const item of result.items || []) {
                matches.push({
                    source: 'backend',
                    name: item.nameZh || item.name,
                    identifier: item.pluginKey,
                    description: item.descriptionZh || item.description,
                    installs: item.totalDownloads || 0,
                })
            }
        } catch (err) {
            logger.agent.warn('[SkillService] Backend skill market search failed:', err)
        }

        if (matches.length === 0) {
            try {
                // 兜底检索在对话主链路上被触发，给一个较短上限，避免外部市场不可达时卡住
                const external = await Promise.race([
                    this.searchMarketplace(keyword),
                    new Promise<MarketplaceResult[]>(resolve => setTimeout(() => resolve([]), 6000)),
                ])
                for (const item of external.slice(0, limit)) {
                    matches.push({
                        source: 'skills.sh',
                        name: item.name,
                        identifier: item.package,
                        description: '',
                        installs: item.installs,
                    })
                }
            } catch {
                // 外部市场不可达时忽略，走无来源分支
            }
        }

        return matches.slice(0, Math.max(1, limit))
    }

    /**
     * 根据用户消息智能匹配相关 Skills
     *
     * 匹配规则（任一命中即视为相关，触发完整内容注入）：
     * 1. Skill 的 keywords 中的词出现在用户消息中（不区分大小写）
     * 2. Skill 的 name 中的核心词（长度 > 2 的分词）出现在用户消息中
     * 3. Skill 的 description 中的核心名词（长度 >= 3 的英文词 / 中文词）出现在用户消息中
     * 4. 用户消息中的核心词出现在 Skill 的 keywords / name / description 中（反向匹配）
     * 5. 仅匹配 type=auto 且 enabled 的 Skills
     */
    matchSkillsByKeywords(skills: SkillItem[], userMessage: string): SkillItem[] {
        if (!userMessage?.trim()) return []

        const msgLower = userMessage.toLowerCase()
        const matched: SkillItem[] = []

        // 提取用户消息中的核心词（英文词 + 中文 2-4 字片段）
        const enWords: string[] = msgLower.match(/[a-z]{3,}/g) || []
        const zhWords: string[] = msgLower.match(/[\u4e00-\u9fa5]{2,4}/g) || []
        const msgWords = new Set<string>([...enWords, ...zhWords])

        const autoEnabled = skills.filter(s => s.type === 'auto' && s.enabled)

        for (const skill of autoEnabled) {
            let isMatched = false

            // 规则1：keywords 命中用户消息
            if (!isMatched && skill.keywords && skill.keywords.length > 0) {
                for (const kw of skill.keywords) {
                    if (msgLower.includes(kw.toLowerCase())) {
                        isMatched = true
                        break
                    }
                }
            }

            // 规则2：name 分词命中用户消息
            if (!isMatched) {
                const nameWords = skill.name.split(/[-_]/).filter(w => w.length > 2)
                for (const w of nameWords) {
                    if (msgLower.includes(w.toLowerCase())) {
                        isMatched = true
                        break
                    }
                }
            }

            // 规则3：description 核心词命中用户消息
            if (!isMatched && skill.description) {
                const descLower = skill.description.toLowerCase()
                for (const w of msgWords) {
                    if (w.length >= 3 && descLower.includes(w)) {
                        isMatched = true
                        break
                    }
                }
            }

            // 规则4：用户消息核心词命中 skill 的 keywords / name / description（反向匹配）
            if (!isMatched) {
                const skillText = `${(skill.keywords || []).join(' ')} ${skill.name} ${skill.description || ''}`.toLowerCase()
                for (const w of msgWords) {
                    if (w.length >= 3 && skillText.includes(w)) {
                        isMatched = true
                        break
                    }
                }
            }

            if (isMatched) {
                matched.push(skill)
            }
        }

        return matched
    }

    /**
     * 构建 Skills 轻量索引（仅 name + description，不含完整内容）
     *
     * Progressive Disclosure 模式：
     * - 系统提示词只注入索引（~100 tokens/skill）
     * - AI 通过 apply_skill 工具按需加载完整内容
     */
    buildSkillsIndex(skills: SkillItem[]): string {
        const enabled = skills.filter(s => s.enabled)

        // 没有任何已安装技能时必须显式说明：直接留空会让模型误以为「技能只是没列出来」，
        // 转而凭名字推测去调用 apply_skill（例如把场景模式声明的技能名当成已安装技能）。
        if (enabled.length === 0) {
            return `## Available Skills

No skill is installed in this workspace or the global skills directory, so there is nothing for \`apply_skill\` to load.

- Do NOT call \`apply_skill\`: a skill name that is not listed here does not exist.
- Never invent, translate, reorder or guess a skill name. A name appearing elsewhere (scene-mode skill lists, plugin descriptions, marketplace pages) is NOT proof that the skill is installed.
- If a task looks like it needs a specialised skill, finish it with the available tools, or tell the user the skill is not installed and can be installed from 「插件与技能市场」.`
        }

        // 清单本身也吃预算：技能数量增长后，逐条罗列会先于技能内容挤占上下文。
        // 超预算的条目折叠成一条提示，完整内容仍可经检索或按名加载。
        const { included, foldedNotice } = buildSkillManifest(
            enabled.map(s => ({ name: s.name, description: s.description })),
            SKILL_MANIFEST_BUDGET_TOKENS
        )

        const index = included.map(s => {
            const safeName = s.name.replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c] || c))
            return `- **${safeName}**: ${s.description}`
        }).join('\n')

        return `## Available Skills

The following project-specific skills can be loaded using the \`apply_skill\` tool.

**Only these exact names are loadable** — copy the name from the list verbatim. A name that does not appear below is not installed: never invent, translate or guess a skill name, and never treat a scene-mode skill name or plugin name as an installed skill.

**IMPORTANT — Proactive Application**:
Before starting any non-trivial task, review the skill list below. If a skill's description suggests it covers the task's domain (e.g. website building, UI design, testing, code review), you MUST call \`apply_skill\` to load its full instructions BEFORE writing code. Following skill instructions ensures consistency with project conventions and avoids rework.

Skills whose keywords match the user's message are already loaded in full above — use \`apply_skill\` to load any additional skills that seem relevant.

${index}${foldedNotice ?? ''}`
    }

    /**
     * 构建 Skills prompt section（完整内容注入，用于 manual @mention 的 skills）
     */
    buildSkillsPrompt(skills: SkillItem[]): string {
        const enabled = skills.filter(s => s.enabled)
        if (enabled.length === 0) return ''

        const sections = enabled.map(s => {
            // 防注入安全：转义 </skill> 标签
            const safeContent = s.content.replace(/<\/skill>/gi, '<\\/skill>')
            const installPath = `${this.SKILLS_DIR}/${s.name}/`
            const safeName = s.name.replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c] || c))
            const safePath = installPath.replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c] || c))
            return `<skill name="${safeName}" path="${safePath}">\n${s.description}\n\n${safeContent}\n</skill>`
        }).join('\n\n')

        return `## Applied Skills

### Usage Guidelines
- **Execution Directory (CRITICAL)**: When executing ANY shell commands (e.g., via \`run_command\`) associated with a skill, you MUST set the \`cwd\` parameter to the skill's installation \`path\`. DO NOT execute skill commands in the project root unless explicitly instructed by the user.
- **Path Awareness**: Each skill's installation path is provided in its \`path\` attribute. If a skill's instructions mention relative paths like "./data.json", they are relative to the skill's \`path\`.
- **Environment Adaptation**: Adapt commands (e.g., shell syntax, executable names like "python" vs "python3") to your current environment (Windows). Translate shell scripts to \`.bat\`/\`.cmd\` commands if necessary, and handle path separators correctly.
- **Tool Integration**: Use the provided tools (shell, file, etc.) to execute these skills as instructed.

${sections}`
    }

    /**
     * 更新 Skill 触发模式（保存到 typeOverrides 配置）
     */
    async updateSkillType(name: string, type: SkillTriggerType): Promise<boolean> {
        const config = await this.loadConfig()
        if (!config.typeOverrides) config.typeOverrides = {}

        if (type === 'auto') {
            // auto 是默认值，移除覆盖
            delete config.typeOverrides[name]
        } else {
            config.typeOverrides[name] = type
        }

        await this.saveConfig(config)

        // 更新缓存
        if (this.cache) {
            const skill = this.cache.find(s => s.name === name)
            if (skill) skill.type = type
        }

        notifySkillsChanged()
        return true
    }

    /**
     * 更新技能的场景归属（写入配置覆盖，不改动 SKILL.md）
     *
     * 内置技能位于随客户端分发的只读目录，无法回写 frontmatter，
     * 因此统一用配置覆盖来表达调整结果，对三层技能同样生效。
     * @param sceneModes 生效的场景模式列表；传空数组表示所有模式可见
     */
    async updateSkillSceneMode(name: string, sceneModes: string[]): Promise<boolean> {
        const config = await this.loadConfig()
        if (!config.sceneModeOverrides) config.sceneModeOverrides = {}

        const value = sceneModes.map(m => m.trim()).filter(Boolean).join(',')
        if (value) {
            config.sceneModeOverrides[name] = value
        } else {
            delete config.sceneModeOverrides[name]
        }

        await this.saveConfig(config)

        // 更新缓存
        if (this.cache) {
            const skill = this.cache.find(s => s.name === name)
            if (skill) skill.sceneMode = value || undefined
        }

        notifySkillsChanged()
        return true
    }


    /**
     * 清除缓存
     */
    clearCache(): void {
        this.cache = null
        this.configCache = null
        // 配置目录可能随用户设置变化，重新解析路径
        this.configPathCache = null
        this.lastScanTime = 0
        notifySkillsChanged()
    }

    // ============================================
    // 配置管理
    // ============================================

    /**
     * 解析技能配置文件的绝对路径（机器级）
     *
     * 配置存放在全局技能目录下，与工作区解耦：未打开工作区时技能开关同样落盘。
     * 该目录由主进程负责创建并纳入读写白名单，渲染进程可直接读写。
     */
    private async resolveConfigPath(): Promise<string | null> {
        if (this.configPathCache) return this.configPathCache
        try {
            const globalDir = await api.skills.getGlobalDir()
            if (!globalDir) return null
            this.configPathCache = joinPath(globalDir, this.CONFIG_FILE)
            return this.configPathCache
        } catch {
            return null
        }
    }

    /** 读取旧版工作区级配置（仅用于迁移），文件不存在或损坏时返回 null */
    private async loadLegacyWorkspaceConfig(): Promise<SkillConfig | null> {
        const { workspacePath } = useStore.getState()
        if (!workspacePath) return null

        const content = await api.file.read(joinPath(workspacePath, this.LEGACY_CONFIG_FILE))
        if (!content) return null

        try {
            return JSON.parse(content) as SkillConfig
        } catch {
            return null
        }
    }

    private async loadConfig(): Promise<SkillConfig> {
        if (this.configCache) return this.configCache

        const configPath = await this.resolveConfigPath()
        if (!configPath) return { disabled: [] }

        const content = await api.file.read(configPath)
        if (content) {
            try {
                const config = JSON.parse(content) as SkillConfig
                this.configCache = config
                return config
            } catch (err) {
                // 配置损坏时以默认值继续，等待下次写入覆盖
                logger.agent.warn('[SkillService] Invalid skills config, fallback to default:', err)
            }
        }

        // 兼容迁移：早期版本把配置写在工作区 .aweeclaw/skills/ 下，
        // 首次以机器级读取时把旧配置搬到全局目录，之后不再回读。
        const legacy = await this.loadLegacyWorkspaceConfig()
        if (legacy) {
            this.configCache = legacy
            await api.file.write(configPath, JSON.stringify(legacy, null, 2))
            logger.agent.info('[SkillService] Migrated skills config to global scope')
            return legacy
        }

        return { disabled: [] }
    }

    private async saveConfig(config: SkillConfig): Promise<void> {
        this.configCache = config

        const configPath = await this.resolveConfigPath()
        if (!configPath) return

        await api.file.write(configPath, JSON.stringify(config, null, 2))
    }
}

export const skillService = new SkillService()
