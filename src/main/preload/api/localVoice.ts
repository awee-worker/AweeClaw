/**
 * 本地语音引擎 API — preload 侧桥接
 *
 * 将主进程的本地语音引擎能力暴露给渲染进程，
 * 渲染进程通过 window.electronAPI.localVoice.* 调用。
 *
 * @module preload/api/localVoice
 */

import { ipcRenderer } from 'electron'
import { invoke, on } from '../ipcHelpers'

/** 统一 IPC 返回包装 */
interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * 创建本地语音引擎 API
 */
export function createLocalVoiceApi() {
  return {
    // --------------------------------------------
    // 配置
    // --------------------------------------------
    /** 获取本地语音配置 */
    getConfig: invoke<IpcResponse>('local-voice:get-config'),
    /** 更新本地语音配置 */
    updateConfig: (config: unknown) =>
      ipcRenderer.invoke('local-voice:update-config', config) as Promise<IpcResponse>,
    /** 重置本地语音配置 */
    resetConfig: invoke<IpcResponse>('local-voice:reset-config'),

    // --------------------------------------------
    // 状态
    // --------------------------------------------
    /** 获取本地语音状态 */
    getStatus: invoke<IpcResponse>('local-voice:get-status'),

    // --------------------------------------------
    // 引擎初始化
    // --------------------------------------------
    /** 初始化 ASR 引擎 */
    initializeAsr: invoke<IpcResponse>('local-voice:initialize-asr'),
    /** 初始化 TTS 引擎 */
    initializeTts: invoke<IpcResponse>('local-voice:initialize-tts'),
    /** 初始化 GPT-SoVITS 引擎 */
    initializeGptSovits: invoke<IpcResponse>('local-voice:initialize-gpt-sovits'),

    // --------------------------------------------
    // 语音处理
    // --------------------------------------------
    /** 语音识别 */
    recognize: (params: { audioData: string; sampleRate?: number }) =>
      ipcRenderer.invoke('local-voice:recognize', params) as Promise<IpcResponse>,
    /** 语音合成 */
    synthesize: (params: { text: string; voice?: string; speed?: number }) =>
      ipcRenderer.invoke('local-voice:synthesize', params) as Promise<IpcResponse>,
    /** GPT-SoVITS 语音合成 */
    synthesizeGptSovits: (params: { text: string; referenceAudio?: string; language?: string }) =>
      ipcRenderer.invoke('local-voice:synthesize-gpt-sovits', params) as Promise<IpcResponse>,

    // --------------------------------------------
    // 模型管理
    // --------------------------------------------
    /** 获取可用模型列表 */
    getAvailableModels: invoke<IpcResponse>('local-voice:get-available-models'),
    /** 下载模型 */
    downloadModel: (params: { modelId: string }) =>
      ipcRenderer.invoke('local-voice:download-model', params) as Promise<IpcResponse>,
    /** 取消下载 */
    cancelDownload: (params: { modelId: string }) =>
      ipcRenderer.invoke('local-voice:cancel-download', params) as Promise<IpcResponse>,

    // --------------------------------------------
    // 事件订阅
    // --------------------------------------------
    /** 下载进度 */
    onDownloadProgress: on<unknown>('local-voice:download-progress'),
  }
}