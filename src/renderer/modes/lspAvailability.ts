/**
 * LSP 可用性判定
 *
 * 语言服务器服务于代码阅读与修改：悬停类型、跳转定义、诊断同步。这些能力
 * 只在「代码开发」场景下有意义——日常办公、生活陪伴、学习探索场景不编辑源码，
 * 启动语言服务器只会白白吃掉内存与 CPU（单个 Vue/TS 服务实例带一个 tsserver，
 * 索引大仓库时常驻数百 MB）。
 *
 * 因此这里给出唯一的判定入口，设置页控制入口可见性、编辑器控制服务启停，
 * 两处共用同一判据，避免出现「设置里看不到、后台还在跑」的不一致。
 */

import type { SceneMode } from '@protocols/sceneModeProtocol'

/** LSP 能力所属场景 */
export const LSP_SCENE_MODE: SceneMode = 'dev'

/** 当前场景是否允许使用语言服务器 */
export function isLspAvailable(sceneMode: SceneMode | null | undefined): boolean {
  return sceneMode === LSP_SCENE_MODE
}