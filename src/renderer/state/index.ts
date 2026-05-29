/**
 * 全局状态管理
 * 使用 Zustand 和 Slices 模式组织状态
 */
import { create } from 'zustand'
import {
  createFileSlice, FileSlice,
  createSettingsSlice, SettingsSlice,
  createThemeSlice, ThemeSlice,
  createLogSlice, LogSlice,
  createMcpSlice, McpSlice,
  createDebugSlice, DebugSlice,
  createDialogSlice, DialogSlice,
  createLayoutSlice, LayoutSlice,
  createGitSlice, GitSlice,
  createEditorStateSlice, EditorStateSlice,
  createAuthSlice, AuthSlice,
  createAgentWorkspaceSlice, AgentWorkspaceSlice,
} from './slices'


// 导出类型
export type { OpenFile, WorkspaceConfig, LargeFileInfo } from './slices'
export type { ProviderModelConfig, SettingsState, SettingKey } from './slices'
// 类型从 shared/config/types 导入
export type { LLMConfig, AutoApproveSettings, AgentConfig } from '@shared/configuration/providerTypes'
export type { SecurityPolicyPanel } from '@shared/configuration/providerTypes'
export type { ThemeName, ThemeMode } from './slices'
export type { ToolCallLogEntry } from './slices'
export type { McpSlice } from './slices'
export type { DebugSlice, Breakpoint } from './slices'
export type { SidePanel } from './slices'
export type { CloudUser, CloudQuota } from './slices'
export type { WorkspaceAgent, AgentWorkspaceSession, AgentToolCall, AgentProgressEvent, TeamChatMessage } from './slices'

// 模式管理统一从 modeStore 导出
export { useModeStore } from '@/renderer/modes/workModeStore'
export type { WorkMode } from '@/renderer/modes/workModeTypes'

// 组合所有 slices
export type StoreState = FileSlice & SettingsSlice & ThemeSlice & LogSlice & McpSlice & DebugSlice
  & DialogSlice & LayoutSlice & GitSlice & EditorStateSlice & AuthSlice & AgentWorkspaceSlice

export const useStore = create<StoreState>()((...args) => ({
  ...createFileSlice(...args),
  ...createSettingsSlice(...args),
  ...createThemeSlice(...args),
  ...createLogSlice(...args),
  ...createMcpSlice(...args),
  ...createDebugSlice(...args),
  ...createDialogSlice(...args),
  ...createLayoutSlice(...args),
  ...createGitSlice(...args),
  ...createEditorStateSlice(...args),
  ...createAuthSlice(...args),
  ...createAgentWorkspaceSlice(...args),
}))
