/// <reference types="vite/client" />

import type { useStore } from './store'

/**
 * AweeClaw 客户端全局类型声明
 *
 * 为渲染进程注入的全局变量、Vite 环境变量、浏览器扩展 API
 * 提供 TypeScript 类型支持。
 *
 * @module AweeClawGlobalEnv
 */
declare global {
  /**
   * AweeClaw 全局 Store 桥接
   *
   * 由渲染进程在启动时注入，供主进程在截图/主题快照等场景读取当前状态。
   */
  interface Window {
    /** AweeClaw Redux Store 句柄（主进程只读访问） */
    __AWEECLAW_STORE__: {
      getState: typeof useStore.getState
    }
    /** 设置变更订阅取消函数 */
    __settingsUnsubscribe?: () => void
    /** 错误监听取消函数 */
    __errorUnsubscribe?: () => void
  }

  /** 生产环境标记（由 Vite Define 注入） */
  var __PROD__: boolean

  /**
   * User-Agent Client Hints（Navigator.userAgentData）
   * 浏览器标准扩展，用于精准识别平台与品牌。
   */
  interface NavigatorUAData {
    /** 操作系统平台，如 "macOS"、"Windows" */
    platform: string
    /** 是否为移动设备 */
    mobile: boolean
    /** 浏览器品牌列表 */
    brands: Array<{ brand: string; version: string }>
  }

  interface Navigator {
    /** User-Agent Client Hints（部分浏览器支持） */
    userAgentData?: NavigatorUAData
  }
}

export {}
