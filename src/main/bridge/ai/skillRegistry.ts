/**
 * Skills 注册表 — 全局技能目录管理
 *
 * 职责：
 * - 暴露全局 Skills 目录路径查询 IPC 接口
 * - 自动创建用户级 Skills 目录
 * - 将 Skills 目录注册到安全白名单，允许 Agent 访问
 * - 提供 skills:list / skills:read IPC，读取 global + workspace 级技能（prompt 片段）
 *
 * 技能文件约定（只读 prompt 片段，非可调用工具）：
 * - 单文件：{skillsDir}/{name}.md          → 技能名 = 文件名（去 .md）
 * - 目录式：{skillsDir}/{name}/SKILL.md     → 技能名 = 目录名（也兼容 skill.md）
 * - 描述提取优先级：frontmatter `description:` → 首个 `# 标题` → 首段非空文本（截断 120 字符）
 *
 * 作用域：
 * - global：{userConfigDir}/skills/
 * - workspace：{workspaceRoot}/.aweeclaw/skills/（可多个工作区）
 * - 同名技能 global 优先；workspace 仅作补充，不覆盖 global
 */

import * as path from 'path'
import * as fs from 'fs'
import { safeIpcHandle } from '../core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { getUserConfigDir } from '../../modules/configPath'
import { securityManager } from '../../guard/securityPolicyEngine'

// ─── 类型 ────────────────────────────────────────────

type SkillScope = 'global' | 'workspace'

interface SkillInfo {
  name: string
  description: string
  scope: SkillScope
}

interface SkillContent {
  name: string
  content: string
  scope: SkillScope
}

// ─── 目录解析 ────────────────────────────────────────

/** 全局技能目录 */
function getGlobalSkillsDir(): string {
  return path.join(getUserConfigDir(), 'skills')
}

/** 工作区技能目录（每个工作区根下的 .aweeclaw/skills/） */
function getWorkspaceSkillsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.aweeclaw', 'skills')
}

/**
 * 收集所有需要扫描的技能目录
 * @returns [{ dir, scope }] 列表，global 在前
 */
function collectSkillDirs(workspacePaths?: string[]): Array<{ dir: string; scope: SkillScope }> {
  const dirs: Array<{ dir: string; scope: SkillScope }> = [{ dir: getGlobalSkillsDir(), scope: 'global' }]
  if (Array.isArray(workspacePaths)) {
    for (const root of workspacePaths) {
      if (typeof root === 'string' && root.trim()) {
        dirs.push({ dir: getWorkspaceSkillsDir(root), scope: 'workspace' })
      }
    }
  }
  return dirs
}

// ─── 描述提取 ────────────────────────────────────────

/**
 * 从技能 markdown 内容中提取描述
 *
 * 优先级：
 * 1. YAML frontmatter 中的 description 字段
 * 2. 首个一级标题 `# xxx`（去掉 # 与空白）
 * 3. 首段非空纯文本（截断 120 字符）
 */
function extractDescription(content: string): string {
  if (!content) return ''

  // 1. frontmatter description
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const fm = fmMatch[1]
    const descLine = fm.match(/^description:\s*(.+)$/m)
    if (descLine && descLine[1]) {
      return descLine[1].trim().replace(/^["']|["']$/g, '').slice(0, 120)
    }
  }

  // 2. 首个一级标题
  const lines = content.split('\n')
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+?)\s*$/)
    if (h1 && h1[1]) return h1[1].trim().slice(0, 120)
  }

  // 3. 首段非空文本
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
      return trimmed.slice(0, 120)
    }
  }

  return ''
}

// ─── 目录扫描 ────────────────────────────────────────

interface DiscoveredSkill {
  name: string
  /** 技能内容文件绝对路径 */
  filePath: string
  scope: SkillScope
}

/**
 * 扫描单个技能目录，发现其中所有技能
 *
 * 支持两种形态：
 * - {dir}/{name}.md
 * - {dir}/{name}/SKILL.md（或 skill.md）
 */
async function scanSkillsDir(dir: string, scope: SkillScope): Promise<DiscoveredSkill[]> {
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    // 目录不存在或无权限 → 静默返回空（技能目录是可选的）
    return []
  }

  const found: DiscoveredSkill[] = []

  for (const entry of entries) {
    if (entry.isFile()) {
      if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
        const name = entry.name.replace(/\.mdx?$/, '')
        if (name) found.push({ name, filePath: path.join(dir, entry.name), scope })
      }
    } else if (entry.isDirectory()) {
      // 目录式技能：{name}/SKILL.md
      const candidates = ['SKILL.md', 'skill.md', 'INDEX.md', 'index.md']
      for (const cand of candidates) {
        const file = path.join(dir, entry.name, cand)
        try {
          await fs.promises.access(file, fs.constants.R_OK)
          found.push({ name: entry.name, filePath: file, scope })
          break
        } catch {
          // 该候选文件不存在，尝试下一个
        }
      }
    }
  }

  return found
}

/**
 * 列出所有技能（global 优先，workspace 补充，同名不覆盖）
 */
async function listAllSkills(workspacePaths?: string[]): Promise<SkillInfo[]> {
  const dirs = collectSkillDirs(workspacePaths)
  const seen = new Set<string>()
  const result: SkillInfo[] = []

  for (const { dir, scope } of dirs) {
    const discovered = await scanSkillsDir(dir, scope)
    for (const skill of discovered) {
      if (seen.has(skill.name)) continue
      seen.add(skill.name)
      let description = ''
      try {
        const content = await fs.promises.readFile(skill.filePath, 'utf-8')
        description = extractDescription(content)
      } catch {
        // 读取失败仍保留技能条目，描述留空
      }
      result.push({ name: skill.name, description, scope })
    }
  }

  return result
}

/**
 * 读取指定技能内容
 *
 * 查找顺序：global → workspace，首个命中即返回
 */
async function readSkillByName(
  name: string,
  workspacePaths?: string[],
): Promise<SkillContent | null> {
  if (!name || typeof name !== 'string') return null
  // 防止路径穿越：技能名只允许字母数字下划线连字符
  if (/[\\/:]/.test(name) || name.includes('..')) return null

  const dirs = collectSkillDirs(workspacePaths)

  for (const { dir, scope } of dirs) {
    // 单文件形态
    const singleFile = path.join(dir, `${name}.md`)
    if (await fileReadable(singleFile)) {
      try {
        const content = await fs.promises.readFile(singleFile, 'utf-8')
        return { name, content, scope }
      } catch (err) {
        logger.ipc.warn(`[Skills] Failed to read ${singleFile}:`, err)
      }
    }

    // 目录形态
    for (const cand of ['SKILL.md', 'skill.md', 'INDEX.md', 'index.md']) {
      const dirFile = path.join(dir, name, cand)
      if (await fileReadable(dirFile)) {
        try {
          const content = await fs.promises.readFile(dirFile, 'utf-8')
          return { name, content, scope }
        } catch (err) {
          logger.ipc.warn(`[Skills] Failed to read ${dirFile}:`, err)
          break
        }
      }
    }
  }

  return null
}

async function fileReadable(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

// ─── IPC 注册 ────────────────────────────────────────

export function registerSkillsHandlers(): void {
  const globalSkillsDir = getGlobalSkillsDir()

  // 将全局技能目录加入安全白名单，允许 Agent / 工具访问
  securityManager.addAllowedAppPath(globalSkillsDir)

  // 自动创建用户级技能目录
  fs.promises.mkdir(globalSkillsDir, { recursive: true }).catch(() => {})

  // 查询全局技能目录路径
  safeIpcHandle('skills:getGlobalDir', async () => {
    await fs.promises.mkdir(globalSkillsDir, { recursive: true })
    return globalSkillsDir
  })

  // 列出所有技能（global + workspace）
  safeIpcHandle('skills:list', async (_evt, workspacePaths?: string[]) => {
    try {
      const skills = await listAllSkills(workspacePaths)
      return { success: true, skills }
    } catch (err) {
      logger.ipc.error('[Skills IPC] list error:', err)
      return { success: false, skills: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 读取指定技能内容
  safeIpcHandle('skills:read', async (_evt, name: string, workspacePaths?: string[]) => {
    try {
      const skill = await readSkillByName(name, workspacePaths)
      return { success: true, skill }
    } catch (err) {
      logger.ipc.error(`[Skills IPC] read "${name}" error:`, err)
      return {
        success: false,
        skill: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  logger.ipc.info('[Skills IPC] Handlers registered')
}
