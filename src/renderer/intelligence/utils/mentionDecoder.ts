/**
 * @ 提及解析器
 * 解析用户输入中的 @file、@skill、@plugin 等提及
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { FileText, Folder, Wrench, Puzzle } from 'lucide-react'
import { skillService } from '@intelligence/runtime/skillRepository'
import { BRAND } from '@shared/brand'
import { resolveLucideIcon, isImageIcon } from '@components/plugin/pluginIconResolver'
export type MentionType = 'file' | 'folder' | 'skill' | 'plugin'
export interface MentionCandidate {
    id: string
    type: MentionType
    label: string
    /** 中文名称（技能/插件有中文名时提供，用于中文界面显示） */
    labelZh?: string
    description?: string
    /** 中文描述（技能/插件有中文描述时提供） */
    descriptionZh?: string
    icon?: any
    data?: any
    score?: number
}

export interface MentionParseResult {
    trigger: string
    query: string
    range: { start: number; end: number }
}

export class MentionParser {
    /**
     * 解析文本中的 @ 提及
     */
    static parse(text: string, cursorPosition: number): MentionParseResult | null {
        const textBeforeCursor = text.slice(0, cursorPosition)
        const lastAt = textBeforeCursor.lastIndexOf('@')

        if (lastAt === -1) return null

        // @ 前必须是空白或行首
        if (lastAt > 0 && !/\s/.test(textBeforeCursor[lastAt - 1])) {
            return null
        }

        const query = textBeforeCursor.slice(lastAt + 1)

        // 查询中不能有空白
        if (/[\s\n]/.test(query)) return null

        return {
            trigger: '@',
            query,
            range: { start: lastAt, end: cursorPosition }
        }
    }

    /**
     * 获取建议列表
     */
    static async getSuggestions(
        query: string,
        workspacePath: string | null,
        options: { includeFiles?: boolean; includeFolders?: boolean } = { includeFiles: true, includeFolders: true }
    ): Promise<MentionCandidate[]> {
        const lowerQuery = query.toLowerCase()
        const suggestions: MentionCandidate[] = []

        // 1. 匹配已安装的 Skills
        try {
            const skills = await skillService.getSkills()
            const enabledSkills = skills.filter(s => s.enabled)

            for (const skill of enabledSkills) {
                const label = `@${skill.name.toLowerCase()}`
                const nameZh = skill.metadata?.nameZh
                const labelZh = nameZh ? `@${nameZh}` : undefined
                // 支持按英文名或中文名（若有）匹配
                if (label.includes(lowerQuery) || (labelZh && labelZh.includes(lowerQuery))) {
                    // 技能图标：metadata.icon 图片 URL 直传字符串，lucide 名按名解析，缺省用 Wrench
                    let skillIcon: unknown = Wrench
                    const rawIcon = skill.metadata?.icon
                    if (isImageIcon(rawIcon)) {
                        skillIcon = rawIcon
                    } else {
                        skillIcon = resolveLucideIcon(rawIcon) || Wrench
                    }
                    suggestions.push({
                        id: `skill-${skill.filePath}`,
                        type: 'skill',
                        label: label,
                        labelZh,
                        description: skill.description || 'Custom Skill',
                        descriptionZh: skill.metadata?.descriptionZh,
                        icon: skillIcon,
                        data: {
                            skillId: skill.name.toLowerCase(),
                            name: skill.name
                        }
                    })
                }
            }
        } catch (err) {
            logger.agent.error('Error fetching skills for mention:', err)
        }

        // 2. 匹配已安装的 Plugins
        try {
            const { getInstalledPlugins } = await import('../../adapters/pluginService')
            const plugins = await getInstalledPlugins()
            const enabledPlugins = plugins.filter(p => p.enabled)

            for (const plugin of enabledPlugins) {
                const manifest = plugin.manifest || {}
                const name = (manifest.name as string) || plugin.pluginKey || plugin.pluginId
                const label = `@${name.toLowerCase()}`
                const nameZh = manifest.nameZh as string | undefined
                const labelZh = nameZh ? `@${nameZh}` : undefined
                // 支持按英文名或中文名（若有）匹配
                if (label.includes(lowerQuery) || (labelZh && labelZh.includes(lowerQuery))) {
                    // 插件图标：manifest.icon 图片 URL 直传字符串，lucide 名按名解析，缺省用 Puzzle
                    const rawIcon = manifest.icon as string | undefined
                    let pluginIcon: unknown = Puzzle
                    if (isImageIcon(rawIcon)) {
                        pluginIcon = rawIcon
                    } else {
                        pluginIcon = resolveLucideIcon(rawIcon) || Puzzle
                    }
                    suggestions.push({
                        id: `plugin-${plugin.pluginKey}`,
                        type: 'plugin',
                        label: label,
                        labelZh,
                        description: (manifest.description as string) || `Plugin v${plugin.version}`,
                        descriptionZh: manifest.descriptionZh as string | undefined,
                        icon: pluginIcon,
                        data: {
                            pluginKey: plugin.pluginKey,
                            pluginId: plugin.pluginId,
                            name: name,
                            types: plugin.types,
                            mcpServerId: plugin.mcpServerId,
                        }
                    })
                }
            }
        } catch (err) {
            logger.agent.error('Error fetching plugins for mention:', err)
        }

        // 3. 搜索文件
        if (workspacePath && (options.includeFiles || options.includeFolders)) {
            try {
                const files = await this.searchFiles(workspacePath, lowerQuery, options)
                suggestions.push(...files)
            } catch (e) {
                logger.agent.error('Error searching files:', e)
            }
        }

        return suggestions
    }

    private static async searchFiles(
        rootPath: string,
        query: string,
        options: { includeFiles?: boolean; includeFolders?: boolean }
    ): Promise<MentionCandidate[]> {
        if (!window.electronAPI) return []

        const candidates: MentionCandidate[] = []

        const collect = async (dir: string, depth: number) => {
            if (depth > 3) return

            const items = await api.file.readDir(dir)
            if (!items) return

            for (const item of items) {
                if (item.name.startsWith('.') && item.name !== '.env') continue
                if (['node_modules', 'dist', 'build', '.git', BRAND.dirName].includes(item.name)) continue

                const relativePath = item.path.replace(rootPath, '').replace(/^[/\\]/, '')
                const match = item.name.toLowerCase().includes(query) || relativePath.toLowerCase().includes(query)

                if (match) {
                    if (item.isDirectory && options.includeFolders) {
                        candidates.push({
                            id: item.path,
                            type: 'folder',
                            label: item.name,
                            description: relativePath,
                            icon: Folder,
                            data: { path: item.path, relativePath }
                        })
                    } else if (!item.isDirectory && options.includeFiles) {
                        candidates.push({
                            id: item.path,
                            type: 'file',
                            label: item.name,
                            description: relativePath,
                            icon: FileText,
                            data: { path: item.path, relativePath }
                        })
                    }
                }

                if (item.isDirectory && depth < 3) {
                    await collect(item.path, depth + 1)
                }
            }
        }

        await collect(rootPath, 0)

        return candidates
            .sort((a, b) => {
                const aMatch = a.label.toLowerCase() === query
                const bMatch = b.label.toLowerCase() === query
                if (aMatch && !bMatch) return -1
                if (!aMatch && bMatch) return 1
                return a.label.localeCompare(b.label)
            })
            .slice(0, 20)
    }
}