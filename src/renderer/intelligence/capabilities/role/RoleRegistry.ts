/**
 * 角色注册表 — 内置角色的静态注册与查询
 *
 * 与 SceneModeRegistry 同构：启动时注册全部内置角色，
 * 运行时的用户修改（启停/覆盖/自定义角色）由 roleLibraryStore 管理，
 * Registry 只负责「内置基线」的查询与合并视图。
 *
 * @see aweeclaw-client/docs/role-library/01-role-library-design.md
 */

import { logger } from '@toolkit/LogEngine'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import type { RoleDescriptor } from './RoleDescriptor'
import { BUILTIN_ROLES } from './BuiltinRoles'

export class RoleRegistry {
  /** 内置角色基线（key: 角色id） */
  private builtins: Map<string, RoleDescriptor> = new Map()

  constructor() {
    BUILTIN_ROLES.forEach(role => {
      this.builtins.set(role.id, role)
    })
    logger.agent.info(`[RoleRegistry] Initialized with ${this.builtins.size} builtin roles`)
  }

  /** 获取内置角色基线（不含用户覆盖） */
  getBuiltin(id: string): RoleDescriptor | undefined {
    return this.builtins.get(id)
  }

  /** 是否为内置角色 */
  isBuiltin(id: string): boolean {
    return this.builtins.has(id)
  }

  /** 获取指定场景的内置角色（含被停用的，供面板展示；由调用方按 enabled 过滤） */
  getBuiltinsByScene(sceneMode: SceneMode): RoleDescriptor[] {
    return Array.from(this.builtins.values()).filter(r => r.sceneMode === sceneMode)
  }

  /** 全部内置角色 */
  getAllBuiltins(): RoleDescriptor[] {
    return Array.from(this.builtins.values())
  }
}

/** 单例 */
export const roleRegistry = new RoleRegistry()
