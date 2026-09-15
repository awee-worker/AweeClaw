/**
 * Preload Bridge — Electron 预加载脚本入口
 *
 * 职责：
 * 1. 聚合各领域 API 模块（appLifecycle / fileOps / storage / ai / ...）
 * 2. 通过 contextBridge 将统一 API 暴露到渲染进程的 window.electronAPI
 *
 * 设计原则：
 * - 单一入口：所有 IPC 频道分发到对应领域模块，本文件不做业务逻辑
 * - 类型最小化：preload 仅保留实现所需的类型，对外契约由 renderer 侧
 *   src/renderer/types/electronBridge.d.ts 维护
 * - 安全隔离：仅通过 contextBridge 暴露白名单 API，不直接暴露 ipcRenderer
 *
 * 模块结构：
 *   preload/
 *   ├── preloadBridge.ts    ← 本文件（入口）
 *   ├── types.ts            本地类型定义
 *   ├── ipcHelpers.ts       IPC 调用辅助函数
 *   └── api/
 *       ├── appLifecycle.ts  应用生命周期 / 窗口 / 国际化
 *       ├── fileOps.ts       文件操作 / 工作区 / 搜索
 *       ├── storage.ts       设置 / SQLite 持久化
 *       ├── ai.ts            LLM / Embedding / 健康检查
 *       ├── terminal.ts      终端 / Shell / 远程 / Git
 *       ├── codeIntel.ts     代码索引 / LSP
 *       ├── mcp.ts           MCP / Skills
 *       ├── channel.ts       多渠道通信 / Agent / 邮件
 *       ├── automation.ts    Cron / Session / Gateway / 诊断 / 安全
 *       ├── pythonData.ts    Python 环境 / 数据分析
 *       ├── scenario.ts      场景管理 / 开发者中心
 *       ├── debugMisc.ts     调试 / 更新 / 审计 / 资源
 *       └── desktop.ts       桌面控制（Phase 1-4）
 *       ├── perception.ts    感知层（阶段2-3）
 *       ├── monitoring.ts    监控层（阶段3）
 *       └── causalReasoning.ts  因果推理（阶段4）
 */
import { contextBridge } from 'electron'

import { createAppLifecycleApi } from './preload/api/appLifecycle'
import { createFileOpsApi } from './preload/api/fileOps'
import { createStorageApi } from './preload/api/storage'
import { createAiApi } from './preload/api/ai'
import { createTerminalApi } from './preload/api/terminal'
import { createCodeIntelApi } from './preload/api/codeIntel'
import { createMcpApi } from './preload/api/mcp'
import { createChannelApi } from './preload/api/channel'
import { createAutomationApi } from './preload/api/automation'
import { createPythonDataApi } from './preload/api/pythonData'
import { createScenarioApi } from './preload/api/scenario'
import { createDebugMiscApi } from './preload/api/debugMisc'
import { createDesktopApi } from './preload/api/desktop'
import { createPluginApi } from './preload/api/plugin'
import { createClipboardApi } from './preload/api/clipboard'
import { createPerceptionApi } from './preload/api/perception'
import { createPerceptionFusionApi } from './preload/api/perceptionFusion'
import { createMonitoringApi } from './preload/api/monitoring'
import { createCausalReasoningApi } from './preload/api/causalReasoning'
import { createIoTBridgeApi } from './preload/api/iot'
import { createSensorFusionApi } from './preload/api/sensorFusion'
import { createProactiveApi } from './preload/api/proactive'
import { createFloatingAvatarApi } from './preload/api/floatingAvatar'
import { createScreenshotOverlayApi } from './preload/api/screenshotOverlay'
import { createScreenshotApi } from './preload/api/screenshot'
import { createMeetingNotesApi } from './preload/api/meetingNotes'
import { createPptPreviewApi } from './preload/api/pptPreview'
import { createOnlyOfficeApi } from './preload/api/onlyOffice'
import { createProjectExecutionApi } from './preload/api/projectExecution'
import { createVideoTranscodeApi } from './preload/api/videoTranscode'
import { createEnvironmentApi } from './preload/api/environment'
import { createDeviceLinkApi } from './preload/api/deviceLink'
import { createExternalAgentApi } from './preload/api/externalAgent'
import { createVrmCompanionApi } from './preload/api/vrmCompanion'
import { createOverlayApi } from './preload/api/overlay'
import { createLiveApi } from './preload/api/live'
import { createVtsApi } from './preload/api/vts'
import { createA2aApi } from './preload/api/a2a'
import { createOpenApiApi } from './preload/api/openApi'
import { createPowerGuardApi } from './preload/api/powerGuard'
import { createSandboxApi } from './preload/api/sandbox'
import { createVmcApi } from './preload/api/vmc'
import { createLocalVoiceApi } from './preload/api/localVoice'
/**
 * 聚合所有领域 API 并暴露到渲染进程。
 *
 * 渲染进程通过 window.electronAPI.* 调用，所有调用经 ipcRenderer
 * 转发到主进程对应处理器。事件订阅返回取消订阅函数，调用方负责清理。
 */
contextBridge.exposeInMainWorld('electronAPI', {
  ...createAppLifecycleApi(),
  ...createFileOpsApi(),
  ...createStorageApi(),
  ...createAiApi(),
  ...createTerminalApi(),
  ...createCodeIntelApi(),
  ...createMcpApi(),
  ...createChannelApi(),
  ...createAutomationApi(),
  ...createPythonDataApi(),
  ...createScenarioApi(),
  ...createDebugMiscApi(),
  ...createDesktopApi(),
  ...createPluginApi(),
  ...createClipboardApi(),
  perception: createPerceptionApi(),
  perceptionFusion: createPerceptionFusionApi(),
  monitoring: createMonitoringApi(),
  causal: createCausalReasoningApi(),
  iot: createIoTBridgeApi(),
  sensorFusion: createSensorFusionApi(),
  proactive: createProactiveApi(),
  floatingAvatar: createFloatingAvatarApi(),
  screenshotOverlay: createScreenshotOverlayApi(),
  screenshot: createScreenshotApi(),
  meetingNotes: createMeetingNotesApi(),
  pptPreview: createPptPreviewApi(),
  onlyOffice: createOnlyOfficeApi(),
  projectExecution: createProjectExecutionApi(),
  videoTranscode: createVideoTranscodeApi(),
  environment: createEnvironmentApi(),
    deviceLink: createDeviceLinkApi(),
    externalAgent: createExternalAgentApi(),
    vrmCompanion: createVrmCompanionApi(),
    overlay: createOverlayApi(),
    live: createLiveApi(),
    vts: createVtsApi(),
    a2a: createA2aApi(),
    openapi: createOpenApiApi(),
    powerGuard: createPowerGuardApi(),
    sandbox: createSandboxApi(),
    vmc: createVmcApi(),
    localVoice: createLocalVoiceApi(),
  })
