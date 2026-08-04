/**
 * 语音上下文缓存
 *
 * 主窗口与头像窗口之间的「语音对话上下文」中转站。
 *
 * 背景：头像窗口是轻量独立 renderer，不导入 @store（聚合 12 个 slice、含 MCP/Monaco/插件
 * 等重依赖，不能在头像窗口创建第二个 store 实例）。但头像窗口的轻量语音对话仍需要
 * llmConfig/cloudMode/serverUrl/accessToken/voiceModelConfig 等运行时上下文。
 *
 * 解决方案：
 * 1. 主窗口 AweeApp 初始化及上下文变化时，通过 IPC push 最新上下文到本缓存。
 * 2. 头像窗口启动时及收到更新事件时，从本缓存读取上下文。
 * 3. 主窗口关闭后（hide-on-close 保留 warm renderer），缓存仍可兜底供头像使用。
 *
 * 设计：单例 + 内存缓存，无持久化（上下文含 token，不应落盘）。
 */

import { logger } from '@shared/toolkit/LogEngine'

/** 语音对话上下文（主窗口 push，头像窗口 get） */
export interface VoiceContext {
  /** LLM 配置（含 provider/model/apiKey 或 cloudMode/serverUrl/accessToken） */
  llmConfig: unknown | null
  /** 云端/本地模式 */
  cloudMode: 'cloud' | 'local'
  /** 后端服务地址（云端模式使用） */
  serverUrl: string | null
  /** 访问令牌（云端模式使用，主窗口关闭后可能过期） */
  accessToken: string | null
  /** 刷新令牌（云端模式使用） */
  refreshToken: string | null
  /** 语音模型配置（STT/TTS 分流依据） */
  voiceModelConfig: unknown | null
  /** 界面语言 */
  language: 'zh' | 'en'
  /** 当前工作区路径（注入系统提示词） */
  workspacePath: string | null
  /** 工作模式（chat/agent/plan，同步主窗口 currentMode） */
  workMode: 'chat' | 'agent' | 'plan' | null
  /** 最后更新时间（ms） */
  updatedAt: number
}

/** 默认上下文（未 push 时兜底） */
const DEFAULT_CONTEXT: VoiceContext = {
  llmConfig: null,
  cloudMode: 'cloud',
  serverUrl: null,
  accessToken: null,
  refreshToken: null,
  voiceModelConfig: null,
  language: 'zh',
  workspacePath: null,
  workMode: 'chat',
  updatedAt: 0,
}

/**
 * 语音上下文缓存（单例）
 *
 * 线程安全说明：Electron 主进程单线程，无需锁。但更新与读取存在竞态时，
 * 以最新 updatedAt 为准（调用方可通过 updatedAt 判断缓存新旧）。
 */
export class VoiceContextCache {
  private static instance: VoiceContextCache | null = null
  private context: VoiceContext = { ...DEFAULT_CONTEXT }

  private constructor() {}

  static getInstance(): VoiceContextCache {
    if (!VoiceContextCache.instance) {
      VoiceContextCache.instance = new VoiceContextCache()
    }
    return VoiceContextCache.instance
  }

  /** 读取当前缓存的语音上下文（返回副本，避免外部篡改） */
  get(): VoiceContext {
    return { ...this.context }
  }

  /**
   * 增量更新语音上下文
   *
   * @param partial 待合并的字段（仅非 undefined 字段会覆盖）
   * @returns 合并后的完整上下文
   */
  update(partial: Partial<VoiceContext>): VoiceContext {
    const next: VoiceContext = {
      ...this.context,
      ...stripUndefined(partial),
      updatedAt: Date.now(),
    }
    this.context = next
    logger.system.info('[VoiceContextCache] Updated', {
      cloudMode: next.cloudMode,
      hasLlmConfig: !!next.llmConfig,
      hasAccessToken: !!next.accessToken,
      hasVoiceModelConfig: !!next.voiceModelConfig,
      language: next.language,
    })
    return this.get()
  }

  /** 重置缓存（退出时调用，清空敏感的 token） */
  clear(): void {
    this.context = { ...DEFAULT_CONTEXT }
    logger.system.info('[VoiceContextCache] Cleared')
  }
}

/** 移除对象中值为 undefined 的字段（避免覆盖已有值） */
function stripUndefined<T extends Record<string, unknown>>(obj: Partial<T>): Partial<T> {
  const result: Partial<T> = {}
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) {
      result[key] = obj[key]
    }
  }
  return result
}
