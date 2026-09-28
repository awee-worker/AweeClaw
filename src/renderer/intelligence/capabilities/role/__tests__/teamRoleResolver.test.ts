/**
 * 团队协作角色解析测试
 *
 * 覆盖三个环节：候选生成（排序与截断）、规划简报（空值语义与约束文案）、
 * 规划产出回解析（roleId / 名称精确 / 名称改写 / 未命中）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RoleDescriptor } from '../RoleDescriptor'

const roleState = vi.hoisted(() => ({ roles: [] as unknown[], fail: false }))

vi.mock('@renderer/modes/roleLibraryStore', () => ({
  useRoleLibraryStore: {
    getState: () => ({
      getEnabledRoles: () => {
        if (roleState.fail) throw new Error('store unavailable')
        return roleState.roles
      },
    }),
  },
}))

import {
  getTeamRoleCandidates,
  buildTeamRoleBriefing,
  resolveTeamRoleForAgent,
  buildTeamRolePersona,
  TEAM_ROLE_CANDIDATE_LIMIT,
} from '../teamRoleResolver'

function makeRole(partial: Partial<RoleDescriptor> & { id: string }): RoleDescriptor {
  return {
    sceneMode: 'work',
    name: 'Role',
    nameZh: '角色',
    description: '一句话说明',
    icon: 'User',
    personaPrompt: '人设正文',
    skillRefs: [],
    toolScopes: ['read'],
    triggers: { keywords: [], intents: [] },
    priority: 50,
    enabled: true,
    builtin: true,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

const FRONTEND = makeRole({
  id: 'work.frontend-engineer',
  name: 'Frontend Engineer',
  nameZh: '前端工程师',
  description: '页面、组件、样式与交互实现',
  personaPrompt: '先确认运行环境与目标终端，再选实现方式',
  outputContract: '说明改动涉及的文件与影响范围',
  priority: 64,
  triggers: { keywords: ['前端', '页面'], intents: ['coding'] },
})

describe('teamRoleResolver', () => {
  beforeEach(() => {
    roleState.roles = []
    roleState.fail = false
  })

  describe('getTeamRoleCandidates', () => {
    it('按优先级降序排列，并裁掉规划不需要的字段', () => {
      roleState.roles = [
        makeRole({ id: 'work.a', nameZh: '低', priority: 10 }),
        makeRole({ id: 'work.b', nameZh: '高', priority: 90 }),
      ]

      const candidates = getTeamRoleCandidates('work')

      expect(candidates.map(c => c.id)).toEqual(['work.b', 'work.a'])
      expect(Object.keys(candidates[0]).sort()).toEqual(
        ['description', 'id', 'keywords', 'name', 'nameZh', 'outputContract', 'personaPrompt', 'priority'].sort()
      )
    })

    it('超出上限时只保留高优先级角色', () => {
      roleState.roles = Array.from({ length: TEAM_ROLE_CANDIDATE_LIMIT + 3 }, (_, i) =>
        makeRole({ id: `work.r${i}`, nameZh: `角色${i}`, priority: i })
      )

      const candidates = getTeamRoleCandidates('work')

      expect(candidates).toHaveLength(TEAM_ROLE_CANDIDATE_LIMIT)
      expect(candidates[0].id).toBe(`work.r${TEAM_ROLE_CANDIDATE_LIMIT + 2}`)
    })

    it('角色库不可用时返回空数组，不抛错', () => {
      roleState.fail = true

      expect(getTeamRoleCandidates('work')).toEqual([])
    })
  })

  describe('buildTeamRoleBriefing', () => {
    it('无候选角色时返回 null（保持规划提示词原样）', () => {
      expect(buildTeamRoleBriefing([])).toBeNull()
    })

    it('列出角色 id 与说明，并要求原样回填 roleId', () => {
      const briefing = buildTeamRoleBriefing(getTeamRoleCandidatesWith([FRONTEND]))

      expect(briefing).toContain('work.frontend-engineer 前端工程师：页面、组件、样式与交互实现')
      expect(briefing).toContain('"roleId"')
      expect(briefing).toContain('Never invent a role id')
    })

    it('命中建议角色时补一行优先提示', () => {
      const briefing = buildTeamRoleBriefing(getTeamRoleCandidatesWith([FRONTEND]), ['work.frontend-engineer'])

      expect(briefing).toContain('Task analysis suggests these positions in particular: work.frontend-engineer')
    })

    it('建议角色不在候选内时不产生优先提示', () => {
      const briefing = buildTeamRoleBriefing(getTeamRoleCandidatesWith([FRONTEND]), ['work.backend-engineer'])

      expect(briefing).not.toContain('suggests these positions')
    })
  })

  describe('resolveTeamRoleForAgent', () => {
    let candidates: ReturnType<typeof getTeamRoleCandidates>

    beforeEach(() => {
      candidates = getTeamRoleCandidatesWith([FRONTEND])
    })

    it('roleId 精确命中', () => {
      const hit = resolveTeamRoleForAgent({ id: 'fe-1', name: '任意名', roleId: 'work.frontend-engineer' }, candidates)

      expect(hit?.id).toBe('work.frontend-engineer')
    })

    it('名称与角色名完全一致时命中', () => {
      expect(resolveTeamRoleForAgent({ id: 'fe-1', name: '前端工程师' }, candidates)?.id)
        .toBe('work.frontend-engineer')
      expect(resolveTeamRoleForAgent({ id: 'fe-1', name: 'Frontend Engineer' }, candidates)?.id)
        .toBe('work.frontend-engineer')
    })

    it('名称加修饰词时仍能命中', () => {
      expect(resolveTeamRoleForAgent({ id: 'fe-1', name: 'Senior Frontend Engineer' }, candidates)?.id)
        .toBe('work.frontend-engineer')
      expect(resolveTeamRoleForAgent({ id: 'fe-1', name: '前端开发工程师' }, candidates)?.id)
        .toBe('work.frontend-engineer')
    })

    it('近似但不同职责的角色不误命中', () => {
      const withBackend = getTeamRoleCandidatesWith([
        FRONTEND,
        makeRole({ id: 'work.backend-engineer', name: 'Backend Engineer', nameZh: '后端工程师' }),
      ])

      expect(resolveTeamRoleForAgent({ id: 'be-1', name: '后端工程师' }, withBackend)?.id)
        .toBe('work.backend-engineer')
      expect(resolveTeamRoleForAgent({ id: 'x-1', name: '市场调研' }, withBackend))
        .toBeNull()
    })

    it('无 roleId 且名称对不上时返回 null（调用侧保持规划器原有角色）', () => {
      expect(resolveTeamRoleForAgent({ id: 'custom-1', name: 'Security Expert' }, candidates)).toBeNull()
      expect(resolveTeamRoleForAgent({ id: 'custom-1', name: '' }, candidates)).toBeNull()
    })
  })

  describe('buildTeamRolePersona', () => {
    it('包含角色标识、人设与输出契约', () => {
      const text = buildTeamRolePersona(getTeamRoleCandidatesWith([FRONTEND])[0])

      expect(text).toContain('work.frontend-engineer')
      expect(text).toContain('前端工程师')
      expect(text).toContain('先确认运行环境与目标终端，再选实现方式')
      expect(text).toContain('OUTPUT CONTRACT: 说明改动涉及的文件与影响范围')
    })

    it('声明人设只细化方法、不覆盖范围与安全边界', () => {
      const text = buildTeamRolePersona(getTeamRoleCandidatesWith([FRONTEND])[0])

      expect(text).toContain('does NOT override your scope')
    })

    it('无输出契约时不输出该段落', () => {
      const role = { ...getTeamRoleCandidatesWith([FRONTEND])[0], outputContract: undefined }

      expect(buildTeamRolePersona(role)).not.toContain('OUTPUT CONTRACT')
    })
  })
})

/** 走一次真实候选生成，保证测试用的是与运行期同一份精简视图 */
function getTeamRoleCandidatesWith(roles: RoleDescriptor[]) {
  roleState.roles = roles
  return getTeamRoleCandidates('work')
}
