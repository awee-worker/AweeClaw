/**
 * 桌面控制模块入口
 * 统一导出管理器、子服务、类型
 */

export { DesktopControlManager, getDesktopControlManager } from './DesktopControlManager'
export { AppLauncher } from './AppLauncher'
export { SystemInfoService } from './SystemInfo'
export { ProcessManager } from './ProcessManager'
export { DesktopGuard } from './DesktopGuard'
export type { ConfirmationRequest, ConfirmationResponse } from './DesktopGuard'

// Phase 3: 紧急停止机制
export {
  getEmergencyStopController,
  EmergencyStopError,
  EmergencyStopController,
  EMERGENCY_STOP_EVENT,
  EMERGENCY_RESET_EVENT,
} from './EmergencyStop'
export type { EmergencyStopSource, EmergencyStopState, EmergencyStopParams } from './EmergencyStop'

// Phase 3: 辅助功能权限引导
export { AccessibilityPermissionService, getAccessibilityPermissionService } from './AccessibilityPermission'
export type {
  AccessibilityPermissionType,
  AccessibilityPermissionStatus,
  AccessibilityPermissionResult,
} from './AccessibilityPermission'

// Phase 4: 操作录制器
export { ActionRecorder, getActionRecorder } from './ActionRecorder'
export {
  RECORDER_EVENT_CHANGE,
  RECORDER_EVENT_RECORDED,
  RECORDER_EVENT_ERROR,
} from './ActionRecorder'
export type {
  RecordedEvent,
  RecordingScript,
  RecordingMetadata,
  RecordingState,
  RecordingSession,
  ReplayConfig,
  ReplayProgress,
  ReplayResult,
  ReplayError,
} from './types/recording'
export { RecordedEventType } from './types/recording'

// Phase 4: 操作回放器
export { ActionReplayer, getActionReplayer } from './ActionReplayer'
export {
  REPLAYER_EVENT_PROGRESS,
  REPLAYER_EVENT_COMPLETED,
  REPLAYER_EVENT_ERROR,
  REPLAYER_EVENT_ABORTED,
} from './ActionReplayer'

// Phase 4: 工作流引擎
export { WorkflowEngine, getWorkflowEngine } from './WorkflowEngine'
export {
  WORKFLOW_EVENT_STATE_CHANGE,
  WORKFLOW_EVENT_STEP_START,
  WORKFLOW_EVENT_STEP_COMPLETE,
  WORKFLOW_EVENT_STEP_ERROR,
  WORKFLOW_EVENT_LOG,
  WORKFLOW_EVENT_COMPLETED,
} from './WorkflowEngine'
export type {
  WorkflowDefinition,
  WorkflowContext,
  WorkflowResult,
  WorkflowRunState,
  WorkflowStep,
  WorkflowTrigger,
  StepRunRecord,
  WorkflowLogEntry,
} from './types/workflow'
export { WorkflowStepType } from './types/workflow'

// Phase 4: 视觉反馈闭环
export { VisualAgentLoop, getVisualAgentLoop } from './VisualAgentLoop'
export {
  VISUAL_LOOP_EVENT_STEP_START,
  VISUAL_LOOP_EVENT_STEP_COMPLETE,
  VISUAL_LOOP_EVENT_STEP_ERROR,
  VISUAL_LOOP_EVENT_COMPLETED,
  VISUAL_LOOP_EVENT_ABORTED,
} from './VisualAgentLoop'
export type {
  VisualAgentLoopConfig,
  VisualLoopStep,
  VisualAction,
  VisualActionType,
  VisualLoopResult,
} from './VisualAgentLoop'

// Phase 5 增量: 自动化模式控制器（沉浸式桌面自动化体验）
export {
  AutomationModeController,
  getAutomationModeController,
  AUTOMATION_EVENT_STATE_CHANGE,
  AUTOMATION_EVENT_STEP,
  AUTOMATION_EVENT_LOG,
  AUTOMATION_OVERLAY_ROUTE,
} from './AutomationModeController'
export type {
  AutomationModeState,
  AutomationStepInfo,
  AutomationEnterParams,
  AutomationStatePayload,
  AutomationStepPayload,
} from './AutomationModeController'

export { getPlatformAdapter } from './platform'
export type { PlatformAdapter } from './platform/types'

export type {
  AppInfo,
  ProcessInfo,
  SystemInfo,
  LaunchResult,
  ActionResult,
  Rect,
} from './types/actions'

export { DesktopOperationType, DesktopPermissionLevel } from './types/permissions'
export type { DesktopPermissionConfig } from './types/permissions'
