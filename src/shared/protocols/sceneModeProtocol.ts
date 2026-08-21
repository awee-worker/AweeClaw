/**
 * 场景模式类型定义（共享）
 *
 * 与 WorkMode（chat/agent/plan，AI 推理深度）正交，
 * SceneMode 控制使用场景：工作 / 生活 / 学习。
 *
 * 两个维度可自由组合，例如「工作场景 + Expert 模式」= 深度工作执行。
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/README.md} 设计文档
 */

/** 场景模式：工作 / 生活 / 学习 */
export type SceneMode = 'work' | 'life' | 'study'

/** 记忆域 tag 前缀 */
export const MEMORY_DOMAIN_TAG_PREFIX = 'domain:'

/** 各场景的记忆域 tag，用于知识库与长期记忆的域隔离 */
export const SCENE_MODE_DOMAIN_TAG: Record<SceneMode, string> = {
  work: 'domain:work',
  life: 'domain:life',
  study: 'domain:study',
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
  return mode === 'work' || mode === 'life' || mode === 'study'
}

/** 获取场景模式的记忆域 tag（未匹配时回退到共享域） */
export function getDomainTag(mode: SceneMode | string): string {
  if (isValidSceneMode(mode)) {
    return SCENE_MODE_DOMAIN_TAG[mode]
  }
  return SHARED_DOMAIN_TAG
}
