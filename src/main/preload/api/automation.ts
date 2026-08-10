/**
 * 自动化 / 会话 / 网关 / 诊断 / 安全 API
 *
 * 覆盖 IPC 频道：
 * - cron:*       定时任务调度
 * - session:*    Agent 会话生命周期
 * - gateway:*    Gateway 守护进程
 * - doctor:*     系统诊断
 * - security:*   权限 / 审批 / 沙箱
 */
import { invoke, on } from '../ipcHelpers'

export function createAutomationApi() {
  return {
    // ── Cron 调度 ──
    cronRegister: (config: unknown) => invoke('cron:register')(config),
    cronUpdate: (taskId: string, updates: unknown) =>
      invoke('cron:update')(taskId, updates),
    cronUnregister: (taskId: string) => invoke('cron:unregister')(taskId),
    cronPause: (taskId: string) => invoke('cron:pause')(taskId),
    cronResume: (taskId: string) => invoke('cron:resume')(taskId),
    cronGetAllTasks: invoke('cron:getAllTasks'),
    cronGetTasksForAgent: (agentId: string) => invoke('cron:getTasksForAgent')(agentId),
    cronStart: invoke('cron:start'),
    cronStop: invoke('cron:stop'),
    // 按 ruleId 操作（自动化规则同步用）
    cronUnregisterByRuleId: (ruleId: string) => invoke('cron:unregisterByRuleId')(ruleId),
    cronPauseByRuleId: (ruleId: string) => invoke('cron:pauseByRuleId')(ruleId),
    cronResumeByRuleId: (ruleId: string) => invoke('cron:resumeByRuleId')(ruleId),
    cronGetTaskByRuleId: (ruleId: string) => invoke('cron:getTaskByRuleId')(ruleId),
    cronUpsertByRuleId: (
      ruleId: string,
      updates: { name?: string; description?: string; expression?: string; command?: string; maxCalls?: number },
      active?: boolean,
    ) => invoke('cron:upsertByRuleId')(ruleId, updates, active),
    onCronTaskStateChanged: on<unknown>('cron:task-state-changed'),
    onCronTaskExecute: on<unknown>('cron:task-execute'),

    // ── Session 生命周期 ──
    sessionGetAllSessions: invoke('session:getAllSessions'),
    sessionGetSessionsForAgent: (agentId: string) =>
      invoke('session:getSessionsForAgent')(agentId),
    sessionGetSession: (sessionId: string) => invoke('session:getSession')(sessionId),
    sessionActivateSession: (sessionId: string) =>
      invoke('session:activateSession')(sessionId),
    sessionResetSession: (sessionId: string) => invoke('session:resetSession')(sessionId),
    sessionArchiveSession: (sessionId: string) =>
      invoke('session:archiveSession')(sessionId),
    sessionGetOrCreateSession: (agentId: string, channelId?: string, dmUserId?: string) =>
      invoke('session:getOrCreateSession')(agentId, channelId, dmUserId),
    sessionUpdateConfig: (config: unknown) => invoke('session:updateConfig')(config),
    sessionGetConfig: invoke('session:getConfig'),

    // ── Gateway 守护进程 ──
    gatewayStart: invoke('gateway:start'),
    gatewayStop: invoke('gateway:stop'),
    gatewayRestart: invoke('gateway:restart'),
    gatewayGetStatus: invoke('gateway:getStatus'),
    gatewayPing: invoke('gateway:ping'),

    // ── 诊断 ──
    doctorRunFullDiagnosis: invoke('doctor:runFullDiagnosis'),
    doctorRunCategoryDiagnosis: (category: string) =>
      invoke('doctor:runCategoryDiagnosis')(category),

    // ── 权限基础 ──
    getPermissions: invoke('security:getPermissions'),
    resetPermissions: invoke('security:resetPermissions'),

    // ── 安全模型（Tool Approval + Sandbox）──
    securityRequestApproval: (
      agentId: string,
      toolName: string,
      toolArgs: Record<string, unknown>,
    ) => invoke('security:requestApproval')(agentId, toolName, toolArgs),
    securityRespondApproval: (requestId: string, approved: boolean, reason?: string) =>
      invoke('security:respondApproval')(requestId, approved, reason),
    securityGetPendingRequests: invoke('security:getPendingRequests'),
    securityUpdateApprovalConfig: (config: unknown) =>
      invoke('security:updateApprovalConfig')(config),
    securitySetAgentApprovalOverride: (agentId: string, override: unknown) =>
      invoke('security:setAgentApprovalOverride')(agentId, override),
    securityRemoveAgentApprovalOverride: (agentId: string) =>
      invoke('security:removeAgentApprovalOverride')(agentId),
    securityClearApprovalCache: invoke('security:clearApprovalCache'),
    securityValidatePath: (filePath: string, agentId?: string) =>
      invoke('security:validatePath')(filePath, agentId),
    securityValidateCommand: (command: string, agentId?: string) =>
      invoke('security:validateCommand')(command, agentId),
    securitySandboxExecute: (command: string, cwd: string, agentId?: string) =>
      invoke('security:sandboxExecute')(command, cwd, agentId),
    securityUpdateSandboxConfig: (config: unknown) =>
      invoke('security:updateSandboxConfig')(config),
    securitySetAgentSandboxOverride: (agentId: string, override: unknown) =>
      invoke('security:setAgentSandboxOverride')(agentId, override),
    securityRemoveAgentSandboxOverride: (agentId: string) =>
      invoke('security:removeAgentSandboxOverride')(agentId),

    // ── Secure Tool Executor ──
    securityPreCheckTool: (request: unknown) => invoke('security:preCheckTool')(request),
    securityValidateFilePath: (filePath: string, agentId?: string) =>
      invoke('security:validateFilePath')(filePath, agentId),

    // ── 安全审批事件 ──
    onSecurityApprovalRequested: on<unknown>('security:approvalRequested'),
  }
}
