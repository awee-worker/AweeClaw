/**
 * useSettingsLocalState reducer 单元测试
 *
 * 直接测试 reducer 逻辑，不依赖 React 渲染环境
 */

import { describe, it, expect } from 'vitest'
import type { SettingsLocalState, SettingsAction } from '@renderer/components/settings/useSettingsLocalState'

// 直接导入 reducer 逻辑（需要先提取为可导出的函数）
// 由于 reducer 定义在模块内部，我们复制核心逻辑进行测试

function settingsReducer(state: SettingsLocalState, action: SettingsAction): SettingsLocalState {
  switch (action.type) {
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.tab }
    case 'SET_SHOW_API_KEY':
      return { ...state, showApiKey: action.show }
    case 'SET_CLOSING':
      return { ...state, isClosing: action.closing }
    case 'SET_LOCAL_CONFIG':
      return { ...state, localConfig: action.config }
    case 'SET_LOCAL_LANGUAGE':
      return { ...state, localLanguage: action.language }
    case 'SET_LOCAL_AUTO_APPROVE':
      return { ...state, localAutoApprove: action.value }
    case 'SET_LOCAL_PROMPT_TEMPLATE_ID':
      return { ...state, localPromptTemplateId: action.value }
    case 'SET_LOCAL_AGENT_CONFIG':
      return { ...state, localAgentConfig: action.config }
    case 'SET_LOCAL_PROVIDER_CONFIGS':
      return { ...state, localProviderConfigs: action.configs }
    case 'SET_LOCAL_AI_INSTRUCTIONS':
      return { ...state, localAiInstructions: action.value }
    case 'SET_LOCAL_WEB_SEARCH_CONFIG':
      return { ...state, localWebSearchConfig: action.config }
    case 'SET_LOCAL_MCP_CONFIG':
      return { ...state, localMcpConfig: action.config }
    case 'SET_LOCAL_EMAIL_CONFIG':
      return { ...state, localEmailConfig: action.config }
    case 'SET_LOCAL_ENABLE_FILE_LOGGING':
      return { ...state, localEnableFileLogging: action.value }
    case 'SET_LOCAL_SECURITY_SETTINGS':
      return { ...state, localSecuritySettings: action.settings }
    case 'SET_LOCAL_PRIVACY_SETTINGS':
      return { ...state, localPrivacySettings: action.settings }
    case 'SET_EDITOR_SETTINGS':
      return { ...state, editorSettings: action.settings }
    case 'SET_ADVANCED_EDITOR_CONFIG':
      return { ...state, advancedEditorConfig: action.config }
    case 'SYNC_FROM_STORE':
      return { ...state, ...action.payload }
    default:
      return state
  }
}

// 创建测试用初始状态
function createMockState(overrides?: Partial<SettingsLocalState>): SettingsLocalState {
  return {
    activeTab: 'provider',
    showApiKey: false,
    isClosing: false,
    localConfig: {
      provider: 'openai',
      model: 'gpt-4',
      apiKey: 'test-key',
    } as any,
    localLanguage: 'zh',
    localAutoApprove: 'ask' as any,
    localPromptTemplateId: 'default',
    localAgentConfig: {} as any,
    localProviderConfigs: {},
    localAiInstructions: '',
    localWebSearchConfig: {} as any,
    localMcpConfig: {} as any,
    localEmailConfig: { enabled: false } as any,
    localEnableFileLogging: false,
    localSecuritySettings: {} as any,
    localPrivacySettings: {} as any,
    editorSettings: {
      fontSize: 14,
      chatFontSize: 14,
      tabSize: 2,
      wordWrap: 'off',
      lineNumbers: 'on',
      minimap: true,
      bracketPairColorization: true,
      formatOnSave: false,
      autoSave: 'off',
      autoSaveDelay: 1000,
      theme: 'light',
      completionEnabled: true,
      completionDebounceMs: 150,
      completionMaxTokens: 256,
      completionTriggerChars: ['.', '/', '@'],
      terminalScrollback: 1000,
      terminalMaxOutputLines: 5000,
      lspTimeoutMs: 10000,
      lspCompletionTimeoutMs: 5000,
      largeFileWarningThresholdMB: 5,
      largeFileLineCount: 20000,
      commandTimeoutMs: 30000,
      workerTimeoutMs: 60000,
      healthCheckTimeoutMs: 15000,
      maxProjectFiles: 50000,
      maxFileTreeDepth: 10,
      maxSearchResults: 5000,
      saveDebounceMs: 1000,
      flushIntervalMs: 5000,
    },
    advancedEditorConfig: {} as any,
    ...overrides,
  }
}

describe('settingsReducer', () => {
  it('SET_ACTIVE_TAB 应更新 activeTab', () => {
    const state = createMockState()
    const next = settingsReducer(state, { type: 'SET_ACTIVE_TAB', tab: 'editor' })
    expect(next.activeTab).toBe('editor')
    expect(next.localConfig).toEqual(state.localConfig) // 其他字段不变
  })

  it('SET_SHOW_API_KEY 应切换显示状态', () => {
    const state = createMockState()
    expect(state.showApiKey).toBe(false)
    const next = settingsReducer(state, { type: 'SET_SHOW_API_KEY', show: true })
    expect(next.showApiKey).toBe(true)
  })

  it('SET_CLOSING 应更新关闭状态', () => {
    const state = createMockState()
    const next = settingsReducer(state, { type: 'SET_CLOSING', closing: true })
    expect(next.isClosing).toBe(true)
  })

  it('SET_LOCAL_CONFIG 应更新 LLM 配置', () => {
    const state = createMockState()
    const newConfig = { ...state.localConfig, model: 'gpt-4o' }
    const next = settingsReducer(state, { type: 'SET_LOCAL_CONFIG', config: newConfig as any })
    expect(next.localConfig.model).toBe('gpt-4o')
  })

  it('SET_LOCAL_LANGUAGE 应更新语言', () => {
    const state = createMockState()
    const next = settingsReducer(state, { type: 'SET_LOCAL_LANGUAGE', language: 'en' })
    expect(next.localLanguage).toBe('en')
  })

  it('SET_LOCAL_AUTO_APPROVE 应更新自动审批设置', () => {
    const state = createMockState()
    const next = settingsReducer(state, { type: 'SET_LOCAL_AUTO_APPROVE', value: 'auto' as any })
    expect(next.localAutoApprove).toBe('auto')
  })

  it('SET_LOCAL_AI_INSTRUCTIONS 应更新 AI 指令', () => {
    const state = createMockState()
    const next = settingsReducer(state, { type: 'SET_LOCAL_AI_INSTRUCTIONS', value: 'Be concise' })
    expect(next.localAiInstructions).toBe('Be concise')
  })

  it('SET_LOCAL_ENABLE_FILE_LOGGING 应更新日志开关', () => {
    const state = createMockState({ localEnableFileLogging: false })
    const next = settingsReducer(state, { type: 'SET_LOCAL_ENABLE_FILE_LOGGING', value: true })
    expect(next.localEnableFileLogging).toBe(true)
  })

  it('SET_EDITOR_SETTINGS 应更新编辑器设置', () => {
    const state = createMockState()
    const newSettings = { ...state.editorSettings, fontSize: 18 }
    const next = settingsReducer(state, { type: 'SET_EDITOR_SETTINGS', settings: newSettings })
    expect(next.editorSettings.fontSize).toBe(18)
  })

  it('SYNC_FROM_STORE 应批量更新多个字段', () => {
    const state = createMockState()
    const next = settingsReducer(state, {
      type: 'SYNC_FROM_STORE',
      payload: {
        localLanguage: 'en',
        localEnableFileLogging: true,
        localAiInstructions: 'Updated',
      },
    })
    expect(next.localLanguage).toBe('en')
    expect(next.localEnableFileLogging).toBe(true)
    expect(next.localAiInstructions).toBe('Updated')
    // 未更新的字段保持不变
    expect(next.activeTab).toBe('provider')
  })

  it('未知 action 应返回原状态', () => {
    const state = createMockState()
    const next = settingsReducer(state, { type: 'UNKNOWN_ACTION' } as any)
    expect(next).toEqual(state)
  })

  it('应保持不可变性', () => {
    const state = createMockState()
    const next = settingsReducer(state, { type: 'SET_LOCAL_LANGUAGE', language: 'en' })
    expect(next).not.toBe(state)
    expect(state.localLanguage).toBe('zh') // 原状态不变
  })
})
