/**
 * 全局资源清理
 *
 * 应用退出前依次停止后台服务，避免：
 * 1. 持久化数据丢失（ModuleDataStore 未 flush）
 * 2. 子进程未终止（LSP、Python、Cron）
 * 3. 网络连接未关闭（Gateway、Channel）
 *
 * 每个步骤都有独立超时，防止单个服务卡死导致应用无法退出。
 */
import { logger } from '@shared/toolkit/LogEngine'
import { destroyIndexService } from '../search-engine/indexOrchestrator'
import { lspManager } from '../language-server/languageServerManager'

/** IPC 模块句柄，由 moduleInitializer 注入 */
let ipcModule: { cleanupAllHandlers: () => void } | null = null

/** 注入 IPC 模块以便清理时调用 cleanupAllHandlers */
export function setIpcModule(module: { cleanupAllHandlers: () => void } | null): void {
  ipcModule = module
}

/** 带超时的 Promise 包装，超时后仅记录日志不抛错 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | void> {
  return Promise.race([
    promise,
    new Promise<void>((resolve) =>
      setTimeout(() => {
        logger.system.warn(`[Cleanup] Timeout (${ms}ms): ${label}`)
        resolve()
      }, ms),
    ),
  ])
}

let cleanupStarted = false

/**
 * 快速杀死所有子进程（用于自动更新场景）
 *
 * 自动更新时 NSIS 安装器会尝试卸载旧版本，但旧版本文件仍被子进程锁定。
 * 此函数快速杀死终端、LSP、调试器等子进程，释放文件锁，
 * 让 NSIS 安装器能成功卸载旧版本。
 *
 * 与 performGlobalCleanup 的区别：
 * - performGlobalCleanup: 优雅退出，保存状态，等待 flush（5秒超时）
 * - performFastCleanup: 立即杀死子进程，不等待 flush（500ms 超时）
 */
export async function performFastCleanup(): Promise<void> {
  logger.system.info('[Cleanup] Starting fast cleanup for auto-update...')

  // 0.5 悬浮头像 + 系统托盘 + 会议纪要窗口 + PPT 预览窗口（快速销毁，释放窗口资源）
  try {
    const { FloatingAvatarManager } = await import('../modules/floating-avatar/FloatingAvatarManager')
    const { TrayManager } = await import('../modules/floating-avatar/TrayManager')
    const { MeetingNotesManager } = await import('../modules/meeting-notes/MeetingNotesManager')
    const { PptPreviewManager } = await import('../modules/ppt-preview/PptPreviewManager')
    FloatingAvatarManager.getInstance().destroy()
    TrayManager.getInstance().destroy()
    try { MeetingNotesManager.getInstance().destroy() } catch { /* 模块未初始化 */ }
    try { PptPreviewManager.getInstance().destroy() } catch { /* 模块未初始化 */ }
    try {
      const { VrmCompanionManager } = await import('../modules/vrm-companion/VrmCompanionManager')
      VrmCompanionManager.getInstance().destroy()
    } catch { /* ignore */ }
  } catch {
    /* ignore */
  }

  try {
    // 1. IPC 处理器（包括终端）—— 立即杀死所有终端子进程
    ipcModule?.cleanupAllHandlers()
  } catch (err) {
    logger.system.warn('[Cleanup] IPC cleanup error:', err)
  }

  // 1.5 设备联动模块（关闭 WebSocket 长连接，避免后端在线设备缓存延迟）
  try {
    const { shutdownDeviceLinkModule } = await import('../modules/device-link/deviceLink.ipc')
    shutdownDeviceLinkModule()
  } catch {
    /* ignore */
  }

  // 1.5 对外 API 网关（释放监听端口）
  //     ⚠️ 必须先于 A2A 清理：网关 stop() 会把监听权交还 A2A，
  //     顺序反了会让 A2A 在网关之后又重新起一个监听
  try {
    const { cleanupOpenApiModule } = await import('../modules/openapi')
    await withTimeout(cleanupOpenApiModule(), 1000, 'OpenApi cleanup (fast)')
  } catch {
    /* ignore */
  }

  // 1.6 A2A 入站服务（释放监听端口，避免「应用已退出但端口仍被占用」）
  try {
    const { cleanupA2aModule } = await import('../modules/a2a')
    await withTimeout(cleanupA2aModule(), 1000, 'A2A cleanup (fast)')
  } catch {
    /* ignore */
  }

  // 2. LSP 服务器（快速杀死，超时 1s）
  try {
    await withTimeout(
      lspManager?.stopAllServers() ?? Promise.resolve(),
      1000,
      'LSP stopAllServers (fast)',
    )
  } catch {
    /* ignore */
  }

  // 3. 自动更新服务（取消定时器与下载，避免退出时触发检查）
  try {
    const { updateService } = await import('../modules/auto-update/AppUpdateService')
    updateService.destroy()
  } catch {
    /* ignore */
  }

  // 4. 模块数据持久化—— 快速 flush（超时 500ms）
  try {
    const { moduleDataStore } = await import('../modules/persistence/ModuleDataStore')
    moduleDataStore.flush()
  } catch {
    /* ignore */
  }

  logger.system.info('[Cleanup] Fast cleanup completed')
}

/** 集中执行所有后台服务的清理，幂等：重复调用直接返回 */
export async function performGlobalCleanup(): Promise<void> {
  if (cleanupStarted) return
  cleanupStarted = true

  logger.system.info('[Cleanup] Starting global cleanup...')
  try {
    // 0.1 防休眠模块 —— 放在**最前面**。
    //     理由：守护子进程是「系统级副作用」，一旦后面的清理步骤卡住（各自有超时，
    //     加起来可达十几秒），用户会看到「应用已经退出了但电脑还是不休眠」。
    //     macOS 靠 `-w <pid>` 能自愈，Linux / Windows 不能，必须显式释放。
    try {
      const { cleanupPowerGuardModule } = await import('../modules/power-guard')
      await withTimeout(cleanupPowerGuardModule(), 2000, 'PowerGuard cleanup')
    } catch {
      /* 模块未初始化时忽略 */
    }

    // 0.2 沙箱模块 —— 与防休眠同为「外部副作用」，也必须早清。
    //     docker：`docker rm -f` 清理超时竞态下残留的容器（CLI 已死但容器还在跑）
    //     e2b：kill 仍在运行的云沙箱（不 kill 会一直计费到云端超时）
    try {
      const { cleanupSandboxModule } = await import('../modules/security/sandbox')
      await withTimeout(cleanupSandboxModule(), 3000, 'Sandbox cleanup')
    } catch {
      /* 模块未初始化时忽略 */
    }

    // 0.2.1 群组记忆模块 —— 清理 IPC 处理器
    try {
      const { cleanupGroupMemoryIpcHandlers } = await import('../modules/memory-db/GroupMemoryIpc')
      cleanupGroupMemoryIpcHandlers()
      const { GroupMemoryManager } = await import('../modules/memory-db/GroupMemoryManager')
      GroupMemoryManager.getInstance().cleanup()
    } catch {
      /* 模块未初始化时忽略 */
    }

    // 0.2.2 本地语音引擎模块 —— 停止所有引擎，释放资源
    try {
      const { cleanupLocalVoiceModule } = await import('../modules/local-voice')
      await withTimeout(cleanupLocalVoiceModule(), 3000, 'LocalVoice cleanup')
    } catch {
      /* 模块未初始化时忽略 */
    }

    // 0.2.3 有声书模块 —— 清理 IPC 处理器
    try {
      const { cleanupAudiobookIpcHandlers } = await import('../modules/audiobook/AudiobookIpc')
      cleanupAudiobookIpcHandlers()
    } catch {
      /* 模块未初始化时忽略 */
    }

    // 0.2.4 VMC 协议模块 —— 清理 IPC 处理器和资源
    try {
      const { destroyVmcModule } = await import('../modules/vmc')
      destroyVmcModule()
    } catch {
      /* 模块未初始化时忽略 */
    }

    // 0.5 悬浮头像 + 系统托盘 + 会议纪要窗口 + PPT 预览窗口（彻底退出时销毁，满足「完全退出头像才消失」需求）
    try {
      const { FloatingAvatarManager } = await import('../modules/floating-avatar/FloatingAvatarManager')
      const { TrayManager } = await import('../modules/floating-avatar/TrayManager')
      const { VoiceContextCache } = await import('../modules/floating-avatar/VoiceContextCache')
      const { MeetingNotesManager } = await import('../modules/meeting-notes/MeetingNotesManager')
      const { PptPreviewManager } = await import('../modules/ppt-preview/PptPreviewManager')
      FloatingAvatarManager.getInstance().destroy()
      TrayManager.getInstance().destroy()
      VoiceContextCache.getInstance().clear()
      try { MeetingNotesManager.getInstance().destroy() } catch { /* 模块未初始化 */ }
      try { PptPreviewManager.getInstance().destroy() } catch { /* 模块未初始化 */ }
    // VRM 桌面伴侣窗口
    try {
      const { VrmCompanionManager } = await import('../modules/vrm-companion/VrmCompanionManager')
      VrmCompanionManager.getInstance().destroy()
    } catch { /* 模块未初始化时忽略 */ }
    } catch {
      /* 模块未初始化时忽略 */
    }

    // 1. IPC 处理器（包括终端）
    ipcModule?.cleanupAllHandlers()

    // 1.5 设备联动模块（关闭 WebSocket 长连接 + EventBridge detach）
    try {
      const { shutdownDeviceLinkModule } = await import('../modules/device-link/deviceLink.ipc')
      shutdownDeviceLinkModule()
    } catch {
      /* ignore */
    }

    // 1.6 直播互动模块（关闭弹幕 WebSocket / 心跳 / 轮询定时器，不留孤儿连接）
    //     超时收紧到 2s：B站关闭项目是一次 HTTP，不能拖住退出流程
    try {
      const { cleanupLiveModule } = await import('../modules/live')
      await withTimeout(cleanupLiveModule(), 2000, 'Live cleanup')
    } catch {
      /* 模块未初始化时忽略 */
    }

    // 1.7 悬浮层模块（释放本地 HTTP 端口与应用内窗口）
    try {
      const { cleanupOverlayModule } = await import('../modules/overlay')
      await withTimeout(cleanupOverlayModule(), 1000, 'Overlay cleanup')
    } catch {
      /* 模块未初始化时忽略 */
    }

    // 1.8 VTS 联动模块（清空帧队列、复位口型、关闭 WebSocket）
    //     顺序在最后：要先让上游停止产出音频帧，再断下行连接，
    //     否则退出瞬间仍在飞的口型帧会打到已关闭的 socket
    try {
      const { cleanupVtsModule } = await import('../modules/vts')
      await withTimeout(cleanupVtsModule(), 1500, 'VTS cleanup')
    } catch {
      /* 模块未初始化时忽略 */
    }

    // 1.85 对外 API 网关（关闭 HTTP 监听，释放端口；SSE 长连接会被强制断开）
    //      ⚠️ 必须先于 A2A：网关 stop() 会把监听权交还 A2A，
    //      否则 A2A 会在网关之后重新起监听，端口又变成占用状态
    try {
      const { cleanupOpenApiModule } = await import('../modules/openapi')
      await withTimeout(cleanupOpenApiModule(), 1500, 'OpenApi cleanup')
    } catch {
      /* 模块未初始化时忽略 */
    }

    // 1.9 A2A 模块（关闭入站 HTTP 监听；出站无长连接，无需额外等待）
    //     必须先于 IPC 清理无关，但要在窗口销毁前完成，避免回调打到已销毁 webContents
    try {
      const { cleanupA2aModule } = await import('../modules/a2a')
      await withTimeout(cleanupA2aModule(), 1500, 'A2A cleanup')
    } catch {
      /* 模块未初始化时忽略 */
    }

    // 2. LSP 服务器（超时 3s）
    await withTimeout(lspManager?.stopAllServers() ?? Promise.resolve(), 3000, 'LSP stopAllServers')

    // 3. 调试会话（超时 2s）
    await withTimeout(
      import('../modules/dap-adapter').then((m) => m.debugService.stopAll()).catch(() => {}),
      2000,
      'DebugService stopAll',
    )

    // 4. 索引 Worker 线程
    try {
      destroyIndexService()
    } catch {
      /* ignore */
    }

    // 5. Cron 调度器
    try {
      const { cronScheduler } = await import('../modules/automation/CronScheduler')
      cronScheduler.stop()
    } catch {
      /* ignore */
    }

    // 5.1 插件级 Cron 调度桥 + 输入监听桥（host bridge 扩展服务）
    try {
      const { getCronSchedulerBridge } = await import('../modules/plugin-sdk/CronSchedulerBridge')
      getCronSchedulerBridge().stop()
    } catch {
      /* ignore */
    }
    try {
      const { getInputListenerBridge } = await import('../modules/plugin-sdk/InputListenerBridge')
      getInputListenerBridge().stopAll()
    } catch {
      /* ignore */
    }

    // 6. Session 生命周期管理器
    try {
      const { sessionLifecycleManager } = await import('../modules/session/SessionLifecycleManager')
      sessionLifecycleManager.stop()
    } catch {
      /* ignore */
    }

    // 7. Gateway 客户端
    try {
      const { gatewayClient } = await import('../modules/gateway/GatewayClient')
      await gatewayClient.stop()
    } catch {
      /* ignore */
    }

    // 8. 自动更新服务（清理定时器、取消下载、移除事件监听）
    try {
      const { updateService } = await import('../modules/auto-update/AppUpdateService')
      updateService.destroy()
    } catch {
      /* ignore */
    }

    // 8.5 AI 网络调度器（关闭 undici 连接池，释放自定义 dispatcher 持有的 keep-alive socket）
    try {
      const { disposeAiDispatcher } = await import('../modules/ai-provider/core/NetworkDispatcher')
      await disposeAiDispatcher()
    } catch {
      /* ignore */
    }

    // 9. 模块数据持久化存储（最后 flush，确保前序服务产生的状态被持久化）
    try {
      const { moduleDataStore } = await import('../modules/persistence/ModuleDataStore')
      moduleDataStore.flush()
    } catch {
      /* ignore */
    }

    logger.system.info('[Cleanup] Global cleanup completed successfully')
  } catch (err) {
    logger.system.error('[Cleanup] Global cleanup error:', err)
  }
}
