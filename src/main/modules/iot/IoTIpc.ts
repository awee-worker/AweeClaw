/**
 * IoT IPC 处理器
 *
 * 在主进程注册 IPC 处理器，暴露 IoTBridge 能力给渲染进程。
 * 渲染进程通过 window.electronAPI.iot.* 调用。
 *
 * 所有方法返回 { success: boolean, data?: T, error?: string } 统一格式。
 *
 * 提供能力：
 * - Bridge 生命周期：start / stop / isRunning / getStatus
 * - Provider 连接管理：connectProvider / disconnectProvider / testProviderConnection
 * - 实体查询：listEntitySnapshots / listEntitySnapshotsByProvider
 * - 适配器管理：registerAdapter / unregisterAdapter / listAdapters（仅查询）
 * - 云端凭据同步：setCredentials / clearCredentials
 * - 事件订阅：onBridgeEvent（通过 ipcRenderer.on 接收推送）
 *
 * 云端回调（拉取 Provider 配置、批量上报读数）在注册时由主进程内部绑定，
 * 不通过 IPC 传递 —— 函数无法被结构化克隆，跨进程传递必然失败。
 * 主进程需要的是凭据（serverUrl + accessToken），由渲染进程推送。
 *
 * @module iot/IoTIpc
 */

import { ipcMain, type BrowserWindow } from 'electron';
import { logger } from '@shared/toolkit/LogEngine';
import { IoTBridge } from './IoTBridge';
import { IoTMetricsCollector } from './IoTMetricsCollector';
import { bindIoTBridgeCallbacks } from './IoTBridgeBindings';
import {
  iotBridgeCredentials,
  type IoTBridgeCredentials,
} from './IoTBridgeCredentials';
import type {
  IoTProtocol,
  IoTProtocolAdapter,
  MetricsWindow,
} from './IoTInterface';

/** IPC 频道前缀 */
const IPC_PREFIX = 'iot:';

/** 包装异步操作为统一 IPC 响应 */
async function wrap<T>(
  fn: () => Promise<T> | T,
): Promise<
  { success: true; data: T } | { success: false; error: string }
> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.iot?.error('[IPC] 操作失败:', e);
    return { success: false, error: msg };
  }
}

/**
 * 注册 IoT IPC 处理器
 *
 * @param mainWindow 主窗口引用（用于推送事件）
 */
export function registerIoTIpc(mainWindow: BrowserWindow | null): void {
  const bridge = IoTBridge.getInstance();

  // 主窗口引用同步到 Bridge
  bridge.setMainWindow(mainWindow);

  // 绑定云端回调：Bridge 启动前必须就绪，否则 start() 会直接拒绝
  bindIoTBridgeCallbacks(bridge);

  // ============================================================
  // Bridge 生命周期
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}start`, async () => {
    return wrap(async () => {
      await bridge.start();
      return true;
    });
  });

  ipcMain.handle(`${IPC_PREFIX}stop`, async () => {
    return wrap(() => bridge.stop());
  });

  ipcMain.handle(`${IPC_PREFIX}isRunning`, async () => {
    return wrap(() => bridge.isRunning());
  });

  ipcMain.handle(`${IPC_PREFIX}getStatus`, async () => {
    return wrap(() => bridge.getStatus());
  });

  // ============================================================
  // Provider 连接管理
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}connectProvider`,
    async (_, providerId: string) => {
      return wrap(() => bridge.connectProvider(providerId));
    },
  );

  ipcMain.handle(
    `${IPC_PREFIX}disconnectProvider`,
    async (_, providerId: string) => {
      return wrap(() => bridge.disconnectProvider(providerId));
    },
  );

  ipcMain.handle(
    `${IPC_PREFIX}testProviderConnection`,
    async (_, providerId: string) => {
      return wrap(() => bridge.testProviderConnection(providerId));
    },
  );

  // ===== 阶段9 s9-10：MQTT 消息发布 =====

  ipcMain.handle(
    `${IPC_PREFIX}publishMessage`,
    async (
      _,
      providerId: string,
      topic: string,
      payload: string,
      options?: { qos?: 0 | 1 | 2; retain?: boolean },
    ) => {
      return wrap(() =>
        bridge.publishMessage(providerId, topic, payload, options),
      );
    },
  );

  // ============================================================
  // 实体查询
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}listEntitySnapshots`, async () => {
    return wrap(() => bridge.listEntitySnapshots());
  });

  ipcMain.handle(
    `${IPC_PREFIX}listEntitySnapshotsByProvider`,
    async (_, providerId: string) => {
      return wrap(() => bridge.listEntitySnapshotsByProvider(providerId));
    },
  );

  // ============================================================
  // 适配器管理（仅查询，注册由插件通过 hostServices 完成）
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}hasAdapter`,
    async (_, protocol: IoTProtocol) => {
      return wrap(() => bridge.hasAdapter(protocol));
    },
  );

  // ============================================================
  // 云端凭据同步
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}setCredentials`,
    async (_, creds: IoTBridgeCredentials) => {
      return wrap(() => {
        if (!creds?.serverUrl || !creds?.accessToken) {
          throw new Error('serverUrl 与 accessToken 均为必填');
        }
        iotBridgeCredentials.set({
          serverUrl: creds.serverUrl.replace(/\/+$/, ''),
          accessToken: creds.accessToken,
        });
        return true;
      });
    },
  );

  ipcMain.handle(`${IPC_PREFIX}clearCredentials`, async () => {
    return wrap(() => {
      iotBridgeCredentials.clear();
      return true;
    });
  });

  // ============================================================
  // 性能指标（阶段8 s8-08 + 阶段9 s9-08）
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}getMetrics`, async () => {
    return wrap(() => IoTMetricsCollector.getInstance().getMetrics());
  });

  ipcMain.handle(
    `${IPC_PREFIX}setMetricsWindow`,
    async (_, window: MetricsWindow) => {
      return wrap(() => {
        IoTMetricsCollector.getInstance().setWindow(window);
        return IoTMetricsCollector.getInstance().getWindow();
      });
    },
  );

  ipcMain.handle(
    `${IPC_PREFIX}getMetricsHistory`,
    async (_, durationMs?: number) => {
      return wrap(() =>
        IoTMetricsCollector.getInstance().getMetricsHistory(durationMs),
      );
    },
  );

  logger.iot?.info('[IoTIpc] 所有 IPC 处理器已注册');
}

/**
 * 直接注册协议适配器（供内置适配器使用）
 *
 * 注意：插件加载的适配器通过 hostServices.bridge.registerIoTAdapter
 * 注册，不走此函数。
 */
export function registerIoTAdapter(adapter: IoTProtocolAdapter): void {
  IoTBridge.getInstance().registerAdapter(adapter);
}

/** 注销协议适配器 */
export function unregisterIoTAdapter(protocol: IoTProtocol): void {
  IoTBridge.getInstance().unregisterAdapter(protocol);
}
