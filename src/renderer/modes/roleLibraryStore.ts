/**
 * 角色库状态管理
 *
 * 沿用场景模式的存储范式（zustand + preferencesStore，通过 IPC 走 settings:get/set）。
 * 存储结构：
 * - roles：内置 + 自定义一起存（内置角色由 registry 提供基线，这里存用户视角的完整状态）
 * - defaultRoleIds：各场景锁定的默认角色（5.2 第一级「显式指定」来源之一）
 * - overrides：对内置角色的字段级覆盖（升级新增字段时用户修改不丢失）
 * - autoMatchEnabled：自动匹配总开关，默认 true
 *
 * @see aweeclaw-client/docs/role-library/01-role-library-design.md 4.2 节
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import { roleRegistry } from '@intelligence/capabilities/role/RoleRegistry'
import type { RoleDescriptor } from '@intelligence/capabilities/role/RoleDescriptor'
import { sceneModeRegistry } from '@intelligence/capabilities/sceneMode/SceneModeRegistry'
import { api } from '../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'

const STORE_KEY = 'roleLibraryStore'

/** 合并覆盖后的角色视图类型（与 RoleDescriptor 相同） */
export type ResolvedRole = RoleDescriptor

/** 保存角色时的校验失败项 */
export interface RoleValidationIssue {
  field: string
  message: string
}

interface RoleLibraryState {
  /** 角色（内置 + 自定义，一起存） */
  roles: RoleDescriptor[]
  /** 各场景锁定的默认角色，null 表示未锁定 */
  defaultRoleIds: Record<SceneMode, string | null>
  /** 对内置角色的字段级覆盖（key: 角色id） */
  overrides: Record<string, Partial<RoleDescriptor>>
  /** 自动匹配总开关，默认 true */
  autoMatchEnabled: boolean
}

interface RoleLibraryActions {
  /** 应用覆盖后取完整角色视图（不存在返回 undefined） */
  getRole: (id: string) => ResolvedRole | undefined
  /** 获取指定场景下启用的角色（应用覆盖） */
  getEnabledRoles: (sceneMode: SceneMode) => ResolvedRole[]
  /** 获取指定场景全部角色（含停用，供面板展示） */
  getRolesByScene: (sceneMode: SceneMode) => ResolvedRole[]
  /** 获取场景默认角色（显式指定来源之一；不存在或已停用返回 null） */
  getDefaultRole: (sceneMode: SceneMode) => ResolvedRole | null
  /** 新建自定义角色（校验失败返回 issues） */
  addRole: (role: RoleDescriptor) => RoleValidationIssue[]
  /** 更新角色：内置走覆盖，自定义整条更新 */
  updateRole: (id: string, patch: Partial<RoleDescriptor>) => RoleValidationIssue[]
  /** 停用/启用 */
  setRoleEnabled: (id: string, enabled: boolean) => void
  /** 删除自定义角色（内置角色不支持） */
  removeCustomRole: (id: string) => void
  /** 锁定/解锁场景默认角色 */
  setDefaultRole: (sceneMode: SceneMode, roleId: string | null) => void
  /** 设置自动匹配开关 */
  setAutoMatchEnabled: (enabled: boolean) => void
  /** 校验角色合法性（id 格式 / 技能引用 / 工具范围） */
  validateRole: (role: RoleDescriptor) => RoleValidationIssue[]
}

type RoleLibraryStore = RoleLibraryState & RoleLibraryActions

/**
 * 自定义 Storage：通过 IPC 存到 electron-store 的 preferencesStore
 */
const electronStoreStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const value = await api.settings.get(`${STORE_KEY}.${name}`)
      return value ? JSON.stringify(value) : null
    } catch {
      return null
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsed = JSON.parse(value)
      await api.settings.set(`${STORE_KEY}.${name}`, parsed)
    } catch {
      /* ignore */
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await api.settings.set(`${STORE_KEY}.${name}`, undefined)
    } catch {
      /* ignore */
    }
  },
}

/** 应用覆盖到内置角色基线 */
function applyOverride(base: RoleDescriptor, override?: Partial<RoleDescriptor>): ResolvedRole {
  return override ? { ...base, ...override } : base
}

/** 全部场景模式（与 sceneModeProtocol 的 SceneMode 保持一致） */
const ALL_SCENE_MODES: SceneMode[] = ['work', 'life', 'study', 'dev']

/** 内置角色 id 迁移映射：work.dev-* → dev.*（内置角色拆分为四场景时引入，用于用户数据迁移） */
const ROLE_ID_MIGRATIONS: Record<string, string> = {
  'work.dev-architect': 'dev.architect',
  'work.dev-frontend': 'dev.frontend',
  'work.dev-backend': 'dev.backend',
  'work.dev-qa': 'dev.qa',
  'work.dev-devops': 'dev.devops',
  'work.dev-data': 'dev.data',
}

/** id 格式校验：<scene>.<slug>（小写字母、数字、点、连字符） */
const ROLE_ID_PATTERN = /^(work|life|study|dev)\.[a-z0-9][a-z0-9-]*$/

export const useRoleLibraryStore = create<RoleLibraryStore>()(
  persist(
    (set, get) => ({
      roles: [],
      defaultRoleIds: { work: null, life: null, study: null, dev: null },
      overrides: {},
      autoMatchEnabled: true,

      getRole: (id) => {
        const { overrides, roles } = get()
        // 自定义角色优先（内置角色不可删除，自定义 id 不会与内置冲突，但防御性处理）
        const custom = roles.find(r => r.id === id && !roleRegistry.isBuiltin(id))
        if (custom) return custom
        const base = roleRegistry.getBuiltin(id)
        if (!base) return roles.find(r => r.id === id) ?? undefined
        return applyOverride(base, overrides[id])
      },

      getEnabledRoles: (sceneMode) => {
        return get().getRolesByScene(sceneMode).filter(r => r.enabled)
      },

      getRolesByScene: (sceneMode) => {
        const { overrides, roles } = get()
        const builtinViews = roleRegistry
          .getBuiltinsByScene(sceneMode)
          .map(base => applyOverride(base, overrides[base.id]))
        const customs = roles.filter(r => r.sceneMode === sceneMode && !roleRegistry.isBuiltin(r.id))
        return [...builtinViews, ...customs].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      },

      getDefaultRole: (sceneMode) => {
        const roleId = get().defaultRoleIds[sceneMode]
        if (!roleId) return null
        const role = get().getRole(roleId)
        return role && role.enabled ? role : null
      },

      validateRole: (role) => {
        const issues: RoleValidationIssue[] = []
        if (!ROLE_ID_PATTERN.test(role.id)) {
          issues.push({ field: 'id', message: 'id 需符合 <scene>.<slug> 格式（小写字母、数字、点、连字符）' })
        }
        const { roles } = get()
        const isBuiltin = roleRegistry.isBuiltin(role.id)
        // 更新内置角色（走覆盖）时 id 与基线重复属正常；自定义角色不允许与已有角色重名
        if (!isBuiltin && roles.some(r => r.id === role.id && r !== (role as RoleDescriptor))) {
          issues.push({ field: 'id', message: '角色 id 已存在' })
        }
        // 技能引用校验：必须 ⊆ 场景 modeSkills ∪ 全局已安装技能。
        // store 层同步校验场景白名单（modeSkills）；已安装技能的并集校验在表单层
        // （可异步拉取 skillService）完成，执行期再静默降级兜底（见设计文档 4.4）
        const sceneSkills = new Set(sceneModeRegistry.getOrDefault(role.sceneMode).modeSkills)
        for (const skill of role.skillRefs) {
          if (!sceneSkills.has(skill)) {
            issues.push({ field: 'skillRefs', message: `技能「${skill}」不在当前场景白名单内` })
          }
        }
        return issues
      },

      addRole: (role) => {
        const issues = get().validateRole(role)
        if (issues.length > 0) return issues
        const exists = roleRegistry.isBuiltin(role.id) || get().roles.some(r => r.id === role.id)
        if (exists) {
          return [{ field: 'id', message: '角色 id 已存在' }]
        }
        set({ roles: [...get().roles, { ...role, builtin: false, updatedAt: Date.now() }] })
        return []
      },

      updateRole: (id, patch) => {
        const { overrides, roles } = get()
        const base = roleRegistry.getBuiltin(id)
        if (base) {
          const merged = { ...base, ...overrides[id], ...patch }
          // 覆盖校验：只校验引用类字段
          const issues = get().validateRole(merged).filter(i => i.field === 'skillRefs')
          if (issues.length > 0) return issues
          set({
            overrides: { ...overrides, [id]: { ...(overrides[id] ?? {}), ...patch, updatedAt: Date.now() } },
          })
          return []
        }
        const idx = roles.findIndex(r => r.id === id)
        if (idx < 0) return [{ field: 'id', message: '角色不存在' }]
        const merged = { ...roles[idx], ...patch }
        const issues = get().validateRole(merged).filter(i => i.field === 'skillRefs')
        if (issues.length > 0) return issues
        const next = [...roles]
        next[idx] = { ...merged, builtin: false, updatedAt: Date.now() }
        set({ roles: next })
        return []
      },

      setRoleEnabled: (id, enabled) => {
        const { overrides, roles } = get()
        if (roleRegistry.isBuiltin(id)) {
          set({ overrides: { ...overrides, [id]: { ...(overrides[id] ?? {}), enabled } } })
          return
        }
        set({
          roles: roles.map(r => (r.id === id ? { ...r, enabled, updatedAt: Date.now() } : r)),
        })
      },

      removeCustomRole: (id) => {
        if (roleRegistry.isBuiltin(id)) return
        const { roles, defaultRoleIds } = get()
        const nextDefaults = { ...defaultRoleIds }
        for (const scene of Object.keys(nextDefaults) as SceneMode[]) {
          if (nextDefaults[scene] === id) nextDefaults[scene] = null
        }
        set({ roles: roles.filter(r => r.id !== id), defaultRoleIds: nextDefaults })
      },

      setDefaultRole: (sceneMode, roleId) => {
        if (roleId) {
          const role = get().getRole(roleId)
          if (!role || role.sceneMode !== sceneMode || !role.enabled) return
        }
        set({ defaultRoleIds: { ...get().defaultRoleIds, [sceneMode]: roleId } })
      },

      setAutoMatchEnabled: (enabled) => {
        set({ autoMatchEnabled: enabled })
      },
    }),
    {
      name: 'aweeclaw-role-library-store',
      storage: createJSONStorage(() => electronStoreStorage),
      partialize: (state) => ({
        roles: state.roles,
        defaultRoleIds: state.defaultRoleIds,
        overrides: state.overrides,
        autoMatchEnabled: state.autoMatchEnabled,
      }),
      // 版本 1：内置研发角色由工作场景迁移到代码开发场景（内置角色拆分为四场景）
      version: 1,
      migrate: (persisted, fromVersion) => {
        const state = persisted as Partial<RoleLibraryState> | undefined
        if (!state) return persisted as RoleLibraryStore
        if (fromVersion >= 1) return state as RoleLibraryStore

        // 改写 overrides 的 key：不改写则用户对研发角色的启停/覆盖设置全部失配，角色恢复默认启用
        if (state.overrides) {
          const nextOverrides: Record<string, Partial<RoleDescriptor>> = {}
          for (const [id, override] of Object.entries(state.overrides)) {
            nextOverrides[ROLE_ID_MIGRATIONS[id] ?? id] = override
          }
          state.overrides = nextOverrides
        }

        // 改写 defaultRoleIds 的引用值
        if (state.defaultRoleIds) {
          const nextDefaults = { ...state.defaultRoleIds }
          for (const scene of ALL_SCENE_MODES) {
            const id = nextDefaults[scene]
            if (id && ROLE_ID_MIGRATIONS[id]) nextDefaults[scene] = ROLE_ID_MIGRATIONS[id]
          }
          state.defaultRoleIds = nextDefaults
        }

        // 清理 roles 中残留的旧 id：新 id 已成为内置角色，旧 id 会被 isBuiltin 判为自定义角色而重复出现
        if (Array.isArray(state.roles)) {
          state.roles = state.roles.filter(r => !ROLE_ID_MIGRATIONS[r.id])
        }

        return state as RoleLibraryStore
      },
      onRehydrateStorage: () => (state) => {
        // 内置角色随版本升级增删：清理指向已移除角色的「场景默认角色」残留，并补全新增场景的 key。
        // 不清理的话，设置面板里对应卡片已经不存在，用户既看不到该默认项，也没有入口取消它。
        if (state) {
          const nextDefaults = { ...state.defaultRoleIds }
          let changed = 0
          for (const scene of ALL_SCENE_MODES) {
            if (!(scene in nextDefaults)) {
              nextDefaults[scene] = null
              changed++
            }
          }
          for (const scene of ALL_SCENE_MODES) {
            const id = nextDefaults[scene]
            if (!id) continue
            const stillExists = roleRegistry.isBuiltin(id) || state.roles.some(r => r.id === id)
            if (!stillExists) {
              nextDefaults[scene] = null
              changed++
            }
          }
          if (changed > 0) {
            state.defaultRoleIds = nextDefaults
            logger.agent.info(`[RoleLibraryStore] Reconciled ${changed} default role entr(ies) after builtin roles changed`)
          }
        }
        logger.agent.info('[RoleLibraryStore] Rehydrated, roles:', state?.roles?.length ?? 0)
      },
    },
  ),
)
