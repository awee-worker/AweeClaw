/**
 * 场景模式类型定义（共享）
 *
 * 与 WorkMode（chat/agent/expert，AI 推理深度）正交，
 * SceneMode 控制使用场景：工作 / 生活 / 学习 / 代码开发。
 *
 * 两个维度可自由组合，例如「工作场景 + Expert 模式」= 深度工作执行。
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/README.md} 设计文档
 */

/** 场景模式：工作 / 生活 / 学习 / 代码开发 */
export type SceneMode = 'work' | 'life' | 'study' | 'dev'

/** 记忆域 tag 前缀 */
export const MEMORY_DOMAIN_TAG_PREFIX = 'domain:'

/** 各场景的记忆域 tag，用于知识库与长期记忆的域隔离 */
export const SCENE_MODE_DOMAIN_TAG: Record<SceneMode, string> = {
  work: 'domain:work',
  life: 'domain:life',
  study: 'domain:study',
  dev: 'domain:dev',
}

/** 跨域共享 tag：所有场景模式均可见的记忆条目 */
export const SHARED_DOMAIN_TAG = 'domain:shared'

/**
 * 规范化场景模式名称。
 * 当前仅接受正式模式名，不维护历史别名。
 */
export function normalizeSceneMode(mode: SceneMode): SceneMode {
  return mode
}

/** 判断字符串是否为有效场景模式 */
export function isValidSceneMode(mode: string): mode is SceneMode {
  return mode === 'work' || mode === 'life' || mode === 'study' || mode === 'dev'
}

/** 获取场景模式的记忆域 tag（未匹配时回退到共享域） */
export function getDomainTag(mode: SceneMode | string): string {
  if (isValidSceneMode(mode)) {
    return SCENE_MODE_DOMAIN_TAG[mode]
  }
  return SHARED_DOMAIN_TAG
}

/**
 * 工作域组：日常办公与代码开发共享同一批记忆。
 *
 * 这两者本是一条工作流的不同阶段（定方案 → 写代码 → 写周报）。
 * 按场景切成互不可见，会让上下文断在模式切换处：
 * 办公模式记下的项目背景，切到代码开发就读不到。
 * 生活与学习仍各自独立，隔离的本意是防止生活/学习内容污染工作上下文。
 */
const WORK_DOMAIN_GROUP: readonly string[] = [SCENE_MODE_DOMAIN_TAG.work, SCENE_MODE_DOMAIN_TAG.dev]

/**
 * 获取某场景可读取的记忆域 tag 集合（含共享域）。
 *
 * 写入仍使用当前场景自身的域标签，只有读侧按域组放开。
 */
export function getReadableDomainTags(mode: SceneMode | string): string[] {
  if (!isValidSceneMode(mode)) return [SHARED_DOMAIN_TAG]
  if (mode === 'work' || mode === 'dev') return [...WORK_DOMAIN_GROUP, SHARED_DOMAIN_TAG]
  return [SCENE_MODE_DOMAIN_TAG[mode], SHARED_DOMAIN_TAG]
}
