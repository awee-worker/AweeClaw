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
 * 剥离不可克隆内容，返回纯对象
 *
 * 渲染进程可能把上一步 IPC 返回的对象（跨上下文引用）再次回传，
 * 这种对象无法被 structuredClone 序列化，会报 "An object could not be cloned."。
 * 配置数据本身是纯 JSON，这里统一做一次深拷贝（失败时回退原值）。
 */
function toSerializable<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
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
      ipcRenderer.invoke('local-voice:update-config', toSerializable(config)) as Promise<IpcResponse>,
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
    downloadModel: (params: { modelId: string; source?: 'modelscope' | 'huggingface' }) =>
      ipcRenderer.invoke('local-voice:download-model', params) as Promise<IpcResponse>,
    /** 取消下载 */
    cancelDownload: (params: { modelId: string }) =>
      ipcRenderer.invoke('local-voice:cancel-download', params) as Promise<IpcResponse>,
    /** 检查模型是否已下载 */
    isModelDownloaded: (params: { modelId: string }) =>
      ipcRenderer.invoke('local-voice:is-model-downloaded', params) as Promise<IpcResponse<{ modelId: string; downloaded: boolean }>>,
    /** 获取模型目录 */
    getModelDir: (params: { modelId: string }) =>
      ipcRenderer.invoke('local-voice:get-model-dir', params) as Promise<IpcResponse<{ modelId: string; modelDir: string | null }>>,
    /** 删除已下载模型 */
    deleteModel: (params: { modelId: string }) =>
      ipcRenderer.invoke('local-voice:delete-model', params) as Promise<IpcResponse<{ modelId: string; removed: boolean }>>,

    // --------------------------------------------
    // 事件订阅
    // --------------------------------------------
    /** 下载进度 */
    onDownloadProgress: on<unknown>('local-voice:download-progress'),
  }
}
