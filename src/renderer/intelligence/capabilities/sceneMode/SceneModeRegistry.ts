/**
 * 场景模式注册表 — 管理所有场景模式的 Profile
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/02-mode-profile.md} 设计文档
 */

import { logger } from '@toolkit/LogEngine'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import { isValidSceneMode } from '@protocols/sceneModeProtocol'
import type { SceneModeProfile } from './SceneModeDescriptor'
import { SCENE_MODE_PROFILES, WORK_MODE_PROFILE } from './SceneModeProfiles'

export class SceneModeRegistry {
  private profiles: Map<SceneMode, SceneModeProfile> = new Map()

  constructor() {
    // 注册默认 Profile
    Object.values(SCENE_MODE_PROFILES).forEach(profile => {
      this.profiles.set(profile.id, profile)
    })
    logger.agent.info('[SceneModeRegistry] Initialized with 3 scene modes')
  }

  /** 注册自定义 Profile */
  register(profile: SceneModeProfile): void {
    this.profiles.set(profile.id, profile)
    logger.agent.debug(`[SceneModeRegistry] Registered scene mode: ${profile.id}`)
  }

  /** 获取 Profile */
  get(mode: SceneMode | string): SceneModeProfile | undefined {
    return this.profiles.get(mode as SceneMode)
  }

  /** 获取 Profile，带回退到工作模式 */
  getOrDefault(mode: SceneMode | string): SceneModeProfile {
    const profile = this.get(mode)
    if (!profile) {
      logger.agent.warn(`[SceneModeRegistry] Unknown scene mode: ${mode}, falling back to work`)
      return WORK_MODE_PROFILE
    }
    return profile
  }

  /** 是否已注册 */
  has(mode: SceneMode | string): boolean {
    return this.profiles.has(mode as SceneMode)
  }

  /** 获取所有模式 */
  getAllModes(): SceneMode[] {
    return Array.from(this.profiles.keys())
  }

  /** 获取所有 Profile */
  getAllProfiles(): SceneModeProfile[] {
    return Array.from(this.profiles.values())
  }

  /** 规范化模式名，无效时返回 null */
  normalize(mode: string): SceneMode | null {
    return isValidSceneMode(mode) ? mode : null
  }
}

/** 单例 */
export const sceneModeRegistry = new SceneModeRegistry()
