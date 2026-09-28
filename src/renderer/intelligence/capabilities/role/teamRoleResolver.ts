/**
 * 团队协作角色来源解析
 *
 * 思考模式的多智能体协作原先只认固定角色枚举：规划器自行发明角色名，
 * 再由 ROLE_MAP 落到工作台枚举，角色库里定义的角色（含用户自建）进不了团队。
 *
 * 本模块把角色库接到「规划 → 执行」之间：
 * - 规划前：把当前场景启用的角色压成简报，注入规划提示词，要求规划器优先选用并回填 roleId
 * - 规划后：把规划产出的 roleId / 角色名解析回角色库角色，用于命名与人设注入
 *
 * 与 resolveSceneRole 的职责区别：那条路径决定「主对话用什么方法做事」，
 * 这条路径决定「团队里哪个位置由谁承担」。
 *
 * @see aweeclaw-client/docs/role-library/01-role-library-design.md 第 6 节
 */

import { logger } from '@toolkit/LogEngine'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import type { RoleDescriptor } from './RoleDescriptor'
import { useRoleLibraryStore } from '@renderer/modes/roleLibraryStore'

/** 注入规划提示词的候选角色（精简视图，只带规划所需字段） */
export interface TeamRoleCandidate {
  id: string
  name: string
  nameZh: string
  description: string
  keywords: string[]
  personaPrompt: string
  outputContract?: string
  priority: number
}

/** 候选上限：超出按优先级截断，避免角色清单占满规划提示词 */
export const TEAM_ROLE_CANDIDATE_LIMIT = 8

function toCandidate(role: RoleDescriptor): TeamRoleCandidate {
  return {
    id: role.id,
    name: role.name,
    nameZh: role.nameZh,
    description: role.description,
    keywords: role.triggers.keywords,
    personaPrompt: role.personaPrompt,
    outputContract: role.outputContract,
    priority: role.priority,
  }
}

/** 取当前场景启用的角色作为团队候选（含用户自定义角色），按优先级降序截断 */
export function getTeamRoleCandidates(
  sceneMode: SceneMode,
  limit = TEAM_ROLE_CANDIDATE_LIMIT
): TeamRoleCandidate[] {
  try {
    const roles = useRoleLibraryStore.getState().getEnabledRoles(sceneMode)
    return [...roles]
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(toCandidate)
  } catch (err) {
    // 角色库不可用不应阻塞团队协作，退化为无角色库的原有行为
    logger.agent.warn('[TeamRoleResolver] Failed to load role candidates:', err)
    return []
  }
}

/**
 * 生成规划提示词的角色库附录
 *
 * 没有候选角色时返回 null，调用侧保持原有提示词不变（行为与改动前一致）。
 *
 * @param preferredRoleIds 复杂度检测给出的建议角色，命中候选时置顶强调
 */
export function buildTeamRoleBriefing(
  candidates: TeamRoleCandidate[],
  preferredRoleIds: string[] = []
): string | null {
  if (candidates.length === 0) return null

  const preferred = candidates.filter(c => preferredRoleIds.includes(c.id))
  const lines: string[] = [
    '## User Role Library (PREFER THESE)',
    '',
    'The user maintains a role library. When a team position matches one of the roles below,',
    'you MUST use that role and copy its exact id into the agent\'s "roleId" field.',
    'If none of them fits a position, omit "roleId" for that agent and describe the role yourself.',
    '',
    ...candidates.map(c => `- ${c.id} ${c.nameZh}：${c.description}`),
  ]

  if (preferred.length > 0) {
    lines.push('')
    lines.push(`Task analysis suggests these positions in particular: ${preferred.map(c => c.id).join(', ')}`)
  }

  lines.push('')
  lines.push('Rules:')
  lines.push('- "roleId" MUST be copied verbatim from the list above. Never invent a role id.')
  lines.push('- The agent "name" still follows the language of the user request.')
  lines.push('- Using a listed role is preferred over inventing a similar one.')

  return lines.join('\n')
}

/** 归一化用于模糊比对：去空白、小写 */
function normalize(text: string): string {
  return text.replace(/[\s_\-.]/g, '').toLowerCase()
}

/**
 * 把规划产出的 agent 解析回角色库角色
 *
 * 解析顺序：roleId 精确匹配 → 名称完全一致 → 归一化后互相包含。
 * 都未命中返回 null，调用侧维持规划器自行发明的角色。
 */
export function resolveTeamRoleForAgent(
  agent: { id?: string; name?: string; roleId?: string },
  candidates: TeamRoleCandidate[]
): TeamRoleCandidate | null {
  if (candidates.length === 0) return null

  if (agent.roleId) {
    const byId = candidates.find(c => c.id === agent.roleId)
    if (byId) return byId
  }

  const name = (agent.name || '').trim()
  if (name) {
    const exact = candidates.find(c => c.nameZh === name || c.name === name)
    if (exact) return exact
  }

  const normalizedName = normalize(name)
  if (normalizedName.length >= 2) {
    const fuzzy = candidates.find(c => {
      const variants = [normalize(c.nameZh), normalize(c.name)]
      return variants.some(v => {
        if (!v) return false
        // 包含关系：英文加修饰词（Senior Frontend Engineer）、中文加后缀都能命中
        if (v.includes(normalizedName) || normalizedName.includes(v)) return true
        // 中文改写容错：首字相同且字符重合度高。
        // 首字约束用来挡住「前端工程师」被「后端工程师」命中的近似误判。
        if (v[0] !== normalizedName[0]) return false
        const setV = new Set(v.split(''))
        const setN = new Set(normalizedName.split(''))
        let hit = 0
        for (const ch of setN) if (setV.has(ch)) hit++
        return hit / Math.min(setV.size, setN.size) >= 0.8
      })
    })
    if (fuzzy) return fuzzy
  }

  const normalizedId = normalize(agent.id || '')
  if (normalizedId.length >= 2) {
    const byAgentId = candidates.find(c => normalizedId.includes(normalize(c.id)))
    if (byAgentId) return byAgentId
  }

  return null
}

/**
 * 角色人设 + 输出契约：追加到子任务的系统提示词末尾
 *
 * 只做追加不做替换，子任务的边界约束与工具约定仍由规划产出与边界包装负责。
 */
export function buildTeamRolePersona(role: TeamRoleCandidate): string {
  const parts = [
    '=== ROLE METHOD ===',
    '',
    `You are acting as: ${role.nameZh} (${role.id})`,
    '',
    role.personaPrompt.trim(),
  ]
  if (role.outputContract) {
    parts.push('')
    parts.push(`OUTPUT CONTRACT: ${role.outputContract}`)
  }
  parts.push('')
  parts.push('This method refines how you work. It does NOT override your scope, your forbidden zone, or the safety rules above.')
  return parts.join('\n')
}
