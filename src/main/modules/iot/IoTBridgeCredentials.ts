/**
 * IoT Bridge 云端凭据持有
 *
 * IoTBridge 需要访问后端 REST 接口（拉取 Provider 运行配置、批量上报读数），
 * 但 accessToken 由渲染进程管理（见 renderer/adapters/backendApi.ts），
 * 主进程无法自行获取，因此由渲染进程通过 IPC 推送。
 *
 * 生命周期：
 * 1. 渲染进程登录 / 恢复会话后推送 { serverUrl, accessToken }
 * 2. accessToken 刷新后再次推送，覆盖旧值
 * 3. 登出或认证失效时清除，主进程停止发起云端请求
 *
 * 主进程不主动刷新 token，避免与渲染进程的刷新逻辑重复。
 *
 * @module iot/IoTBridgeCredentials
 */

import { logger } from '@shared/toolkit/LogEngine';

export interface IoTBridgeCredentials {
  /** 后端服务地址，如 https://gateway.aweeclaw.com */
  serverUrl: string;
  /** JWT accessToken */
  accessToken: string;
}

class IoTBridgeCredentialsHolder {
  private current: IoTBridgeCredentials | null = null;

  set(creds: IoTBridgeCredentials): void {
    this.current = creds;
    logger.iot?.info('[IoTBridgeCredentials] 已同步', {
      serverUrl: creds.serverUrl,
      hasToken: !!creds.accessToken,
    });
  }

  get(): IoTBridgeCredentials | null {
    return this.current;
  }

  clear(): void {
    if (!this.current) return;
    this.current = null;
    logger.iot?.info('[IoTBridgeCredentials] 已清除');
  }

  hasValid(): boolean {
    return !!this.current?.accessToken && !!this.current?.serverUrl;
  }
}

export const iotBridgeCredentials = new IoTBridgeCredentialsHolder();
