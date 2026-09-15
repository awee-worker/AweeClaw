/**
 * VRM 伴侣 IPC 处理器（主进程）
 *
 * 通道清单：
 * - vrm-companion:show | hide | toggle | is-visible        窗口显隐控制
 * - vrm-companion:get-config | update-config               伴侣配置读写（持久化）
 * - vrm-companion:list-models                             列出可用模型（内置 + 用户）
 * - vrm-companion:import-model                            打开文件对话框导入模型
 * - vrm-companion:delete-model                            删除用户模型
 * - vrm-companion:select-model                            选择当前模型
 * - vrm-companion:get-drag-channel                        获取拖拽 IPC 频道名
 * - vrm-companion:set-size | set-position                 尺寸/位置调整（持久化）
 * - vrm-companion:get-state                               读取运行时状态（可见性/穿透/置顶/锁定/不透明度）
 * - vrm-companion:reset-position                          复位窗口到右下角
 * - vrm-companion:set-click-through                       鼠标穿透开关（持久化偏好）
 * - vrm-companion:set-pointer-interactive                 指针压在角色/操作栏 → 临时接管鼠标事件
 * - vrm-companion:set-transient-pass-through              临时穿透（自动隐藏悬停时让开点击）
 * - vrm-companion:get-affection                           读取好感度数据
 * - vrm-companion:check-affection                         从 AI 回复文本提取好感度并更新
 * - vrm-companion:broadcast-speak | stop-speak | volume    主窗口 → 伴侣窗口：口型驱动
 * - vrm-companion:command                                 主窗口 AI → 伴侣窗口：动作/表情指令
 * - vrm-companion:get-voice-context | update-voice-context  语音上下文读写（与悬浮头像共用缓存）
 * - vrm-companion:request-mic-permission                   请求麦克风权限（macOS）
 * - vrm-companion:voice-state-changed | save-conversation   伴侣窗口 → 主窗口：语音状态 / 对话落库
 * - vrm-companion:main-conversation-active                 主窗口 → 伴侣窗口：主窗口语音占用提示
 *
 * 安全：所有 handler 通过 safeIpcHandle 注册，返回值统一包装。
 */

import { dialog, ipcMain, systemPreferences } from 'electron'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { VoiceContextCache, type VoiceContext } from '../floating-avatar/VoiceContextCache'
import { getVrmCompanionManager } from './VrmCompanionManager'
import {
  getConfig,
  updateConfig,
  listModels,
  listAnimations,
  importModel,
  deleteModel,
  downloadOnlineModel,
  loadAffectionData,
  extractAndUpdateAffection,
  type VrmCompanionConfig,
} from './VrmCompanionStore'

/**
 * 是否已注册过。
 *
 * safeIpcHandle 对 handler 是幂等的，但「缓存监听器」不是 ——
 * 重复注册会叠加多个会转发窗口的监听器。用一个显式开关挡住。
 */
let registered = false

/** 注册伴侣相关 IPC（幂等：重复调用直接返回） */
export function registerVrmCompanionIpc(): void {
  if (registered) return
  registered = true

  const manager = getVrmCompanionManager()
  // 语音上下文缓存与悬浮头像共用：主窗口只需 push 一次，两个子窗口都能拿到
  const voiceCache = VoiceContextCache.getInstance()

  // --------------------------------------------
  // 窗口显隐
  // --------------------------------------------
  // 返回值统一为 { success, data: { visible } }，与 preload / renderer 的
  // VrmIpcResponse<{ visible: boolean }> 声明保持一致（否则调用方读 data 恒为 undefined）
  safeIpcHandle('vrm-companion:show', async () => {
    try {
      manager.show()
      return { success: true, data: { visible: manager.isVisible() } }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('vrm-companion:hide', async () => {
    manager.hide()
    return { success: true, data: { visible: manager.isVisible() } }
  })

  safeIpcHandle('vrm-companion:toggle', async () => {
    manager.toggle()
    return { success: true, data: { visible: manager.isVisible() } }
  })

  safeIpcHandle('vrm-companion:is-visible', async () => {
    return { success: true, data: { visible: manager.isVisible() } }
  })

  // --------------------------------------------
  // 配置读写
  // --------------------------------------------
  safeIpcHandle('vrm-companion:get-config', async () => {
    return { success: true, data: getConfig() }
  })

  safeIpcHandle('vrm-companion:update-config', async (_event, partial: unknown) => {
    try {
      const updated = updateConfig((partial as Partial<VrmCompanionConfig>) || {})
      // 窗口级外观项（置顶 / 不透明度）即时生效
      manager.applyConfig(updated)
      // 尺寸变化即时应用
      if (manager.isCreated()) {
        manager.setSize(updated.width, updated.height)
      }
      // 通知伴侣窗口配置已更新（模型切换 / 缩放 / 待机动作 / 视线跟随等）
      manager.send('vrm-companion:config-updated', updated)
      return { success: true, data: updated }
    } catch (err) {
      logger.system.error('[VrmCompanionIpc] update-config failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 一次性读取窗口运行时状态。
   *
   * 设置面板挂载时调用：`clickThrough` 只存在于主进程内存中（不落盘），
   * 没有这个接口设置面板就无法反映真实状态，开关会出现「点了没反应」的假象。
   */
  safeIpcHandle('vrm-companion:get-state', async () => {
    const config = getConfig()
    return {
      success: true,
      data: {
        visible: manager.isVisible(),
        created: manager.isCreated(),
        clickThrough: manager.isClickThrough(),
        alwaysOnTop: config.alwaysOnTop,
        locked: config.locked,
        opacity: config.opacity,
      },
    }
  })

  /** 复位窗口到默认位置（右下角），解决拖到屏幕外后无法找回 */
  safeIpcHandle('vrm-companion:reset-position', async () => {
    try {
      const pos = manager.resetPosition()
      if (!pos) {
        return { success: false, error: 'WINDOW_NOT_CREATED' }
      }
      return { success: true, data: pos }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 模型库
  // --------------------------------------------
  safeIpcHandle('vrm-companion:list-models', async () => {
    try {
      return { success: true, data: listModels() }
    } catch (err) {
      logger.system.error('[VrmCompanionIpc] list-models failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 列出可用动作（.vrma）。
   *
   * 渲染层在模型加载完成后拉取一次，用于构建「待机动作队列」；
   * 动作文件通过 vrm-asset:// 协议读取，无需在这里返回文件内容。
   */
  safeIpcHandle('vrm-companion:list-animations', async () => {
    try {
      return { success: true, data: listAnimations() }
    } catch (err) {
      logger.system.error('[VrmCompanionIpc] list-animations failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('vrm-companion:import-model', async () => {
    try {
      const parent = manager.getWindow()
      const result = parent
        ? await dialog.showOpenDialog(parent, {
            title: '导入 VRM 模型',
            properties: ['openFile'],
            filters: [{ name: 'VRM 模型', extensions: ['vrm', 'glb'] }],
          })
        : await dialog.showOpenDialog({
            title: '导入 VRM 模型',
            properties: ['openFile'],
            filters: [{ name: 'VRM 模型', extensions: ['vrm', 'glb'] }],
          })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'CANCELED' }
      }

      const imported = importModel(result.filePaths[0])
      if (!imported.success) {
        return { success: false, error: imported.error }
      }
      return { success: true, data: imported.model }
    } catch (err) {
      logger.system.error('[VrmCompanionIpc] import-model failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('vrm-companion:delete-model', async (_event, id: unknown) => {
    try {
      const res = deleteModel(String(id ?? ''))
      return res
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 下载在线角色模型（后端模型库 → 用户本地模型目录）。
   *
   * 进度通过 `vrm-companion:download-progress` 单向下发给发起请求的渲染进程，
   * 因为模型文件十几 MB 起步，没有进度反馈用户会以为「点了没反应」。
   */
  safeIpcHandle(
    'vrm-companion:download-online-model',
    async (event, payload: unknown) => {
      try {
        const data = (payload ?? {}) as { id?: string; name?: string; url?: string }
        const result = await downloadOnlineModel({
          name: String(data.name ?? ''),
          url: String(data.url ?? ''),
          onProgress: (received, total) => {
            try {
              event.sender.send('vrm-companion:download-progress', {
                id: data.id ?? null,
                received,
                total,
              })
            } catch {
              // 渲染进程已销毁时忽略进度推送失败
            }
          },
        })
        return result.success
          ? { success: true, data: result.model }
          : { success: false, error: result.error }
      } catch (err) {
        logger.system.error('[VrmCompanionIpc] download-online-model failed:', err)
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  safeIpcHandle('vrm-companion:select-model', async (_event, id: unknown) => {
    try {
      const modelId = id == null ? null : String(id)
      const updated = updateConfig({ modelId })
      // 通知伴侣窗口立即切换模型
      manager.send('vrm-companion:config-updated', updated)
      return { success: true, data: updated }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 拖拽频道
  // --------------------------------------------
  safeIpcHandle('vrm-companion:get-drag-channel', async () => {
    const channels = manager.getDragChannel()
    if (!channels) {
      return { success: false, error: 'Companion window not created yet' }
    }
    return { success: true, data: channels }
  })

  // --------------------------------------------
  // 尺寸 / 位置
  // --------------------------------------------
  safeIpcHandle('vrm-companion:set-size', async (_event, width: unknown, height: unknown) => {
    try {
      manager.setSize(Number(width) || 0, Number(height) || 0)
      return { success: true, data: getConfig() }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('vrm-companion:set-position', async (_event, x: unknown, y: unknown) => {
    try {
      manager.setPosition(Number(x) || 0, Number(y) || 0)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 鼠标穿透
  // --------------------------------------------
  safeIpcHandle('vrm-companion:set-click-through', async (_event, enabled: unknown) => {
    try {
      manager.setClickThrough(Boolean(enabled))
      return { success: true, data: { clickThrough: manager.isClickThrough() } }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 渲染层上报「指针是否压在角色 / 操作栏上」。
   *
   * 穿透模式下窗口忽略鼠标事件，若指针压到操作栏仍不放行事件，按钮就点不动；
   * 主进程据此做「按需临时接管鼠标事件」，只影响单次悬停，不改变穿透偏好。
   */
  safeIpcHandle('vrm-companion:set-pointer-interactive', async (_event, inside: unknown) => {
    try {
      manager.setPointerInteractive(Boolean(inside))
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 设置「临时穿透」（自动隐藏悬停时使用）。
   *
   * 与用户偏好 clickThrough 分开：自动隐藏只是「本次悬停让开点击」，
   * 不能覆盖用户在设置里关闭穿透的意图。
   */
  safeIpcHandle('vrm-companion:set-transient-pass-through', async (_event, enabled: unknown) => {
    try {
      manager.setTransientPassThrough(Boolean(enabled))
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 好感度
  // --------------------------------------------
  safeIpcHandle('vrm-companion:get-affection', async () => {
    try {
      return { success: true, data: loadAffectionData() }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 从 AI 回复文本中提取好感度标签并更新。
   *
   * 调用方：主窗口在 AI 回复完成后调用（携带完整回复文本）。
   * 更新成功后向伴侣窗口推送最新数据，驱动 UI 反馈（如气泡/数值变化）。
   */
  safeIpcHandle('vrm-companion:check-affection', async (_event, content: unknown) => {
    try {
      const updated = extractAndUpdateAffection(String(content ?? ''))
      if (updated) {
        manager.send('vrm-companion:affection-updated', loadAffectionData())
      }
      return { success: true, data: { updated } }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 说话广播（主窗口 → 主进程 → 伴侣窗口）
  // --------------------------------------------
  /**
   * 广播「开始说话」到伴侣窗口以驱动口型。
   *
   * 调用方：主窗口在 AI 开始输出 / 播放 TTS 时调用。
   * 若同时能拿到实时音量，优先用 broadcast-volume 推送（更精确）。
   */
  safeIpcHandle('vrm-companion:broadcast-speak', async (_event, payload: unknown) => {
    try {
      const data = (payload as { text?: string; durationMs?: number }) || {}
      manager.send('vrm-companion:speak', {
        text: String(data.text ?? ''),
        durationMs: typeof data.durationMs === 'number' ? data.durationMs : undefined,
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** 广播「停止说话」到伴侣窗口（立即闭口） */
  safeIpcHandle('vrm-companion:broadcast-stop-speak', async () => {
    try {
      manager.send('vrm-companion:stop-speak')
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** 广播实时音量（0~1）到伴侣窗口，用于精确口型同步 */
  safeIpcHandle('vrm-companion:broadcast-volume', async (_event, volume: unknown) => {
    const v = Number(volume)
    manager.send('vrm-companion:volume', Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)
    return { success: true }
  })

  // --------------------------------------------
  // AI 动作指令（主窗口 AI 工具 → 主进程 → 伴侣窗口）
  // --------------------------------------------
  /**
   * 向伴侣窗口下发一条动作/表情/说话指令。
   *
   * 调用方：主窗口的 companion_control 工具执行器（AI 主动控制角色）。
   * 载荷原样透传给伴侣窗口，由 VrmCompanionApp 解释执行 ——
   * 主进程不做业务校验，避免每新增一个动作都要改主进程。
   */
  safeIpcHandle('vrm-companion:command', async (_event, command: unknown) => {
    try {
      if (!command || typeof command !== 'object') {
        return { success: false, error: 'Invalid command payload' }
      }
      const delivered = manager.isVisible() || manager.isCreated()
      manager.send('vrm-companion:command', command)
      logger.system.info('[VrmCompanionIpc] Command dispatched:', (command as { type?: string }).type)
      // 窗口未创建时指令落空，如实返回 delivered=false，让 AI 知道「伴侣没打开」
      return { success: true, data: { delivered } }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 语音对话（伴侣窗口内独立语音）
  // --------------------------------------------
  /**
   * 读取语音上下文缓存。
   *
   * 伴侣窗口是轻量独立 renderer（不导入 @store），语音对话所需的
   * llmConfig / cloudMode / token / voiceModelConfig 全部来自主窗口 push 的缓存。
   * 与悬浮头像共用同一份 VoiceContextCache。
   */
  safeIpcHandle('vrm-companion:get-voice-context', async () => {
    return { success: true, data: voiceCache.get() }
  })

  /**
   * 主窗口 push 语音上下文（增量）。
   *
   * 写入后由 VoiceContextCache 的监听器自动转发到伴侣窗口，
   * 无需在这里显式 send（见文件末尾的 onUpdate 注册）。
   */
  safeIpcHandle('vrm-companion:update-voice-context', async (_event, partial: unknown) => {
    try {
      const updated = voiceCache.update((partial as Partial<VoiceContext>) || {})
      return { success: true, data: updated }
    } catch (err) {
      logger.system.error('[VrmCompanionIpc] update-voice-context failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 请求麦克风权限（macOS 需主进程触发系统授权弹窗）。
   *
   * 非 macOS 无需主进程介入：渲染进程调用 getUserMedia 时由系统自行处理。
   */
  safeIpcHandle('vrm-companion:request-mic-permission', async () => {
    try {
      if (process.platform !== 'darwin') {
        return { success: true, data: { granted: true, platform: process.platform } }
      }
      const granted = await systemPreferences.askForMediaAccess('microphone')
      logger.system.info('[VrmCompanionIpc] Mic permission (macOS):', granted)
      return { success: true, data: { granted, platform: 'darwin' } }
    } catch (err) {
      logger.system.error('[VrmCompanionIpc] Request mic permission failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 伴侣窗口上报语音状态变化 → 转发主窗口。
   *
   * 主窗口据此联动 UI（例如提示「伴侣对话中」）并让主窗口语音让路，
   * 避免两个窗口同时占用麦克风。
   */
  safeIpcHandle('vrm-companion:voice-state-changed', async (_event, payload: unknown) => {
    try {
      manager.broadcastToOthers('vrm-companion:voice-state-changed', payload)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** 伴侣窗口的对话完成 → 转发主窗口落库（伴侣窗口不维护聊天历史） */
  safeIpcHandle('vrm-companion:save-conversation', async (_event, payload: unknown) => {
    try {
      const conv = payload as { userText?: string; aiText?: string }
      if (!conv || typeof conv.userText !== 'string' || typeof conv.aiText !== 'string') {
        return { success: false, error: 'Invalid conversation payload' }
      }
      manager.broadcastToOthers('vrm-companion:save-conversation', payload)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 主窗口语音对话开关 → 伴侣窗口。
   *
   * 主窗口全功能语音对话激活时，伴侣窗口应暂停自己的麦克风采集，
   * 否则两个窗口会同时录音（互相听到对方 TTS，形成回声）。
   */
  ipcMain.on('vrm-companion:main-conversation-active', (_event, active: unknown) => {
    manager.send('vrm-companion:main-conversation-active', !!active)
  })

  // --------------------------------------------
  // 语音上下文实时推送（VoiceContextCache → 伴侣窗口）
  // --------------------------------------------
  // 注册在缓存上而不是由主窗口分别 push：主窗口只需更新一次缓存，
  // 悬浮头像与伴侣窗口都会收到通知（去重逻辑仍由主窗口的 signature 负责）。
  voiceCache.onUpdate((ctx) => {
    manager.send('vrm-companion:voice-context-updated', ctx)
  })

  logger.system.info('[VrmCompanionIpc] Handlers registered')
}
