/**
 * 二级选项动作注册表
 *
 * 二级选项的 action 类型不在 SKILL.md / manifest 里写实现，只声明动作标识与参数，
 * 由客户端按标识派发到注册好的处理器。这样声明侧（技能作者、插件作者）与实现侧
 * （客户端能力）解耦：新增一个动作只要在客户端注册，存量技能立刻可用。
 *
 * 当前内置动作：
 * - openPluginDrawer：以右侧抽屉打开插件提供的面板，用于模板选择、素材库这类重交互
 * - insertText：把指定文本填入输入框（不自动发送）
 * - sendMessage：把指定文本直接发送出去
 */

import { openPluginDrawer } from '@renderer/plugins/pluginDrawerStore'

/** 动作执行上下文：由调用方（技能栏）提供，处理器按需取用 */
export interface SubSkillActionContext {
  /** 当前界面语言 */
  isZh: boolean
  /** 触发来源技能名（技能条目） */
  skillName?: string
  /** 触发来源插件标识（插件条目） */
  pluginKey?: string
  /** 写入输入框的能力，由调用方注入，避免这里直接依赖 store */
  setDraft?: (text: string) => void
  /** 直接发送消息的能力，由调用方注入 */
  sendMessage?: (text: string) => void
}

export type SubSkillActionHandler = (
  payload: Record<string, unknown>,
  ctx: SubSkillActionContext,
) => void | Promise<void>

const handlers = new Map<string, SubSkillActionHandler>()

/** 注册动作处理器，返回注销函数 */
export function registerSubSkillAction(id: string, handler: SubSkillActionHandler): () => void {
  handlers.set(id, handler)
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id)
  }
}

/** 是否存在可用的处理器 */
export function hasSubSkillAction(id: string): boolean {
  return handlers.has(id)
}

/** 动作执行结果：失败时带上原因，供调用方决定提示方式 */
export interface SubSkillActionResult {
  ok: boolean
  error?: string
}

/**
 * 派发动作
 *
 * 未注册的标识会返回失败而不是静默通过——技能声明了动作但客户端没有实现，
 * 属于配置错误，需要在开发阶段就能被发现。
 */
export async function runSubSkillAction(
  id: string,
  payload: Record<string, unknown> | undefined,
  ctx: SubSkillActionContext,
): Promise<SubSkillActionResult> {
  const handler = handlers.get(id)
  if (!handler) {
    return { ok: false, error: `未注册的二级选项动作: ${id}` }
  }
  try {
    await handler(payload ?? {}, ctx)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── 内置动作 ──────────────────────────────────────────

/**
 * 以抽屉打开插件面板
 *
 * payload.panelId 必须是插件在 manifest.contributes.sidebarPanels 里声明过的 id，
 * PluginUiRegistry 加载插件 UI 时已把该组件的注册进 PanelRegistry，
 * 因此这里只需交给抽屉容器渲染。
 */
registerSubSkillAction('openPluginDrawer', (payload, ctx) => {
  const panelId = typeof payload.panelId === 'string' ? payload.panelId.trim() : ''
  if (!panelId) throw new Error('openPluginDrawer 缺少 panelId')

  openPluginDrawer({
    panelId,
    title: typeof payload.title === 'string' ? payload.title : undefined,
    titleZh: typeof payload.titleZh === 'string' ? payload.titleZh : undefined,
    payload: payload.params && typeof payload.params === 'object'
      ? payload.params as Record<string, unknown>
      : undefined,
  })
  void ctx
})

/** 把文本填入输入框，不发送 */
registerSubSkillAction('insertText', (payload, ctx) => {
  const text = typeof payload.text === 'string' ? payload.text : ''
  if (!text) throw new Error('insertText 缺少 text')
  if (!ctx.setDraft) throw new Error('当前环境不支持写入输入框')
  ctx.setDraft(text)
})

/** 直接发送一条消息 */
registerSubSkillAction('sendMessage', (payload, ctx) => {
  const text = typeof payload.text === 'string' ? payload.text : ''
  if (!text) throw new Error('sendMessage 缺少 text')
  if (!ctx.sendMessage) throw new Error('当前环境不支持发送消息')
  ctx.sendMessage(text)
})
