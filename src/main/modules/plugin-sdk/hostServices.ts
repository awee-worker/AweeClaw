/**
 * Host Services 桥接层
 *
 * 将客户端主进程的 native 能力通过 globalThis.__AWEECLAW_HOST__ 暴露给外部插件，
 * 使插件包内的代码可以访问 Electron API 和桌面控制服务，无需内置在客户端源码中。
 *
 * 暴露的服务：
 * - getDesktopControlManager(): 获取桌面控制管理器（截图/鼠标/键盘/窗口/进程/文件）
 * - macVisionOcrRouter: macOS Vision OCR 路由器
 * - sharp: 图像处理桥（resize/crop/rotate/filter/watermark/convert/info）
 * - ocr: OCR 识别桥（Vision 优先 → Tesseract 降级）
 * - nativeImage: Electron 的 nativeImage 模块
 * - logger: 日志器
 * - McpServer / InMemoryTransport / z: MCP SDK 核心组件
 *
 * 安全约束：
 * - 仅在主进程设置，渲染进程无法访问
 * - globalThis.__AWEECLAW_HOST__ 为全局共享实例，不做权限校验（内置插件可用）
 * - 外部插件应通过 PluginContext.host 访问受限代理（基于 manifest.permissions 校验）
 * - 受限代理由 PluginPermissionGuard.createGuardedHostServices 创建，未声明权限的能力访问会抛错
 * - 完整沙箱隔离（UtilityProcess）待后续实施，当前 JS 代理为第一层防线
 *
 * @module plugin-sdk/hostServices
 */

import { nativeImage } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { getDesktopControlManager } from '../desktop-control/DesktopControlManager'
import { macVisionOcrRouter } from '../desktop-control/MacVisionOcrRouter'
import { sharpBridge } from './SharpBridge'
import { ocrBridge } from './OcrBridge'
import { PerceptionStore } from '../perception/PerceptionStore'
import { LocalEmbedder } from '../perception/LocalEmbedder'
import { VlmModelManager } from '../perception/VlmModelManager'
import { BehaviorPredictor } from '../perception/BehaviorPredictor'
import { CodeDependencyGraph } from '../perception/CodeDependencyGraph'
import { ImpactAnalyzer } from '../perception/ImpactAnalyzer'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import { MonitoringService } from '../monitoring/MonitoringService'
import { IoTBridge } from '../iot/IoTBridge'
import { InputListenerBridge } from './InputListenerBridge'
import { CronSchedulerBridge } from './CronSchedulerBridge'
import { PptPreviewBridge } from './PptPreviewBridge'
// v2.4：导入 PPT 解析函数（必须用 ESM import，不能用 require，
// 否则 vite-plugin-electron 打包时会保留 require() 运行时调用，
// 而 dist/main 下没有 pptxParserMain.js 独立文件，导致 MODULE_NOT_FOUND）
import { parsePptxFile } from './pptxParserMain'
import { getMainWindow, getWindowWorkspace } from '../../bootstrap/windowManager'
import { getConfigStore } from '../../bootstrap/stores'

/** Host 服务接口 */
export interface HostServices {
  /** 获取桌面控制管理器实例 */
  getDesktopControlManager: typeof getDesktopControlManager
  /** macOS Vision OCR 路由器实例 */
  macVisionOcrRouter: typeof macVisionOcrRouter
  /** 图像处理桥（resize/crop/rotate/filter/watermark/convert/info） */
  sharp: typeof sharpBridge
  /** OCR 识别桥（Vision 优先 → Tesseract 降级） */
  ocr: typeof ocrBridge
  /** Electron nativeImage 模块 */
  nativeImage: typeof nativeImage
  /** 日志器（按模块分区） */
  logger: typeof logger
  /** MCP Server 类（来自 @modelcontextprotocol/sdk） */
  McpServer: typeof McpServer
  /** InMemoryTransport 类（来自 @modelcontextprotocol/sdk） */
  InMemoryTransport: typeof InMemoryTransport
  /** zod schema 构建器 */
  z: typeof z
  /** 感知数据存储（LanceDB），供 screen-watcher 等感知插件使用 */
  perceptionStore: PerceptionStore
  /** 本地嵌入模型（@xenova/transformers，供插件向量化场景文本） */
  localEmbedder: LocalEmbedder
  /**
   * VLM 视觉语言模型管理器（阶段8 s8-06/s8-07）
   *
   * 基于 @xenova/transformers 的 image-to-text pipeline（Xenova/vit-gpt2-image-captioning）。
   * 提供图像描述生成能力，支持按需下载（首次 load 时下载约 500MB）。
   * 供 screen-watcher 等感知插件在 OCR 基础上补充图像语义理解。
   */
  vlmModelManager: VlmModelManager
  /** 行为预测器（基于本地嵌入+历史场景检索） */
  behaviorPredictor: BehaviorPredictor
  /** 代码依赖图构建器（多语言解析+BFS 影响分析） */
  codeDependencyGraph: CodeDependencyGraph
  /** 影响分析器（评估变更对项目的影响等级） */
  impactAnalyzer: ImpactAnalyzer
  /** 监控服务（系统指标采集 + 异常检测 + 提前预警） */
  monitoringService: MonitoringService
  /**
   * IoT Bridge（设备协议适配与传感器读数聚合，阶段5）
   *
   * 协议适配器（HomeAssistant/MQTT/自定义）通过 host.iotBridge.registerAdapter()
   * 注册，并经 IoTIpc 暴露给渲染层。
   */
  iotBridge: IoTBridge
  /**
   * 输入监听桥（截图流方案，供 ai-macro-recorder 等插件录制用户操作）
   *
   * V1 采用截图流：定时截屏 + 可选变化检测，推送屏幕时间线给插件。
   * 不依赖 native 输入库，跨平台一致，无需额外系统权限。
   * 插件通过 host.inputListener.startScreenshotStream(options, cb) 启动采集，
   * 在回调中对帧做 VLM 语义化推断。
   */
  inputListener: InputListenerBridge
  /**
   * 插件定时调度桥（独立于主 CronScheduler，供插件注册 cron 任务）
   *
   * 与 automation/CronScheduler（发 command 给 Agent）隔离，本桥触发时直接调用
   * 插件注册的回调，不进入 Agent 对话流。支持注册/取消/暂停/恢复/立即触发，
   * 并提供 unregisterByPlugin 用于插件卸载时批量清理。
   */
  cronScheduler: CronSchedulerBridge
  /** pptxgenjs 库（供 mcp-pptx 等插件生成 PowerPoint 文件） */
  pptxgen: typeof import('pptxgenjs').default
  /** PPT 预览桥（推送幻灯片数据到独立预览窗口，实现实时预览） */
  pptPreview: PptPreviewBridge
  /**
   * 解析已有 .pptx 文件（供 mcp-pptx 插件 open_presentation 工具使用）
   * 在主进程用 jszip + xmldom 解析 OOXML，返回 PptSlideData[] 格式
   */
  parsePptxFile: typeof import('./pptxParserMain').parsePptxFile
  /**
   * 获取当前工作区路径（供插件落盘文件到工作区 .aweeclaw 目录）
   *
   * 优先级：当前主窗口已绑定的工作区 > 持久化的最近工作区 > null
   * 返回 null 时插件应降级到 OS 临时目录。
   */
  getWorkspacePath: () => string | null
}

/** 全局变量名 */
const HOST_GLOBAL_KEY = '__AWEECLAW_HOST__'

/** 标记是否已初始化 */
let initialized = false

/**
 * 初始化 Host 服务桥接，将 native 能力挂载到 globalThis。
 *
 * 在主进程启动时调用一次即可，重复调用幂等。
 * 插件代码通过 `globalThis.__AWEECLAW_HOST__` 访问暴露的服务。
 */
export function initHostServices(): void {
  if (initialized) return
  if (process.type !== 'browser') {
    logger.system?.warn('[HostServices] Not in main process, skipping initialization')
    return
  }

  const services: HostServices = {
    getDesktopControlManager,
    macVisionOcrRouter,
    sharp: sharpBridge,
    ocr: ocrBridge,
    nativeImage,
    logger,
    McpServer,
    InMemoryTransport,
    z,
    // 感知数据存储单例（懒初始化，首次调用 initialize 时才连接 LanceDB）
    perceptionStore: PerceptionStore.getInstance(),
    // 阶段2：本地嵌入模型（懒加载，首次 embed 时才加载 transformers 模型）
    localEmbedder: LocalEmbedder.getInstance(),
    // 阶段8 s8-06/s8-07：VLM 视觉语言模型管理器（懒加载，首次 load 时才下载模型）
    vlmModelManager: VlmModelManager.getInstance(),
    // 阶段2：行为预测器（基于本地嵌入+历史场景检索）
    behaviorPredictor: BehaviorPredictor.getInstance(),
    // 阶段2：代码依赖图构建器（多语言解析+BFS 影响分析）
    codeDependencyGraph: CodeDependencyGraph.getInstance(),
    // 阶段2：影响分析器（评估变更对项目的影响等级）
    impactAnalyzer: ImpactAnalyzer.getInstance(),
    // 阶段3：监控服务（系统指标采集 + 异常检测 + 提前预警）
    monitoringService: MonitoringService.getInstance(),
    // 阶段5：IoT Bridge（设备协议适配与传感器读数聚合）
    iotBridge: IoTBridge.getInstance(),
    // 输入监听桥（截图流方案，供插件录制用户操作）
    inputListener: InputListenerBridge.getInstance(),
    // 插件定时调度桥（独立于主 CronScheduler，供插件注册 cron 回调任务）
    cronScheduler: CronSchedulerBridge.getInstance(),
    // pptxgenjs 库（供 mcp-pptx 等插件生成 PowerPoint）
    // 动态 require 避免 ESM/CJS 互操作问题；pptxgenjs 是 CJS 兼容的
    pptxgen: require('pptxgenjs'),
    // PPT 预览桥（推送幻灯片数据到独立预览窗口）
    pptPreview: PptPreviewBridge.getInstance(),
    // v2.4：解析已有 .pptx 文件（供 mcp-pptx open_presentation 工具使用）
    // 注意：必须用 ESM import 静态引入（顶部已 import），不能在此处 require，
    // 否则 vite-plugin-electron 打包后 require("./pptxParserMain") 找不到模块
    parsePptxFile,
    // 获取当前工作区路径（供插件落盘文件到工作区 .aweeclaw 目录）
    // 优先级：当前主窗口已绑定的工作区 > 持久化的最近工作区 > null
    getWorkspacePath: () => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        const roots = getWindowWorkspace(win.id)
        if (roots && roots.length > 0) return roots[0]
      }
      const session = getConfigStore().get('lastWorkspaceSession') as
        | { roots?: string[] }
        | undefined
      if (session?.roots && session.roots.length > 0) return session.roots[0]
      return (getConfigStore().get('lastWorkspacePath') as string | null) ?? null
    },
  }

  Object.defineProperty(globalThis, HOST_GLOBAL_KEY, {
    value: Object.freeze(services),
    writable: false,
    configurable: false,
    enumerable: false,
  })

  initialized = true
  logger.system?.info('[HostServices] Host services bridge initialized (globalThis.__AWEECLAW_HOST__)')
}

/**
 * 获取 Host 服务（供插件代码调用）。
 *
 * 如果在插件代码中调用，会从 globalThis 读取。
 * 如果未初始化，抛出错误。
 */
export function getHostServices(): HostServices {
  const host = (globalThis as Record<string, unknown>)[HOST_GLOBAL_KEY] as HostServices | undefined
  if (!host) {
    throw new Error(
      'Host services not initialized. Ensure initHostServices() is called in main process startup.',
    )
  }
  return host
}
