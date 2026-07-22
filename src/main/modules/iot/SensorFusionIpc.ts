/**
 * SensorFusion IPC 处理器
 *
 * 在主进程注册 IPC 处理器，暴露 SensorFusionService 能力给渲染进程。
 * 渲染进程通过 window.electronAPI.sensorFusion.* 调用。
 *
 * 提供能力：
 * - 生命周期：start / stop / isRunning
 * - 配置管理：getConfig / updateConfig
 * - 状态查询：getStatus / listEntityWindowStats / getEntityWindowStats
 * - 异常事件订阅：onAnomaly（通过 ipcRenderer.on 接收推送）
 * - 异常事件历史查询（阶段7 s7-07）：queryAnomalies / getRecentAnomalies
 *
 * @module iot/SensorFusionIpc
 */

import { ipcMain, type BrowserWindow } from 'electron';
import { logger } from '@shared/toolkit/LogEngine';
import { SensorFusionService } from './SensorFusionService';
import type { SensorFusionConfig } from './SensorFusionInterface';
import type { AnomalyEventQueryFilter } from './SensorAnomalyEventDb';

/** IPC 频道前缀 */
const IPC_PREFIX = 'sensorFusion:';

/** 异常事件推送频道 */
const ANOMALY_CHANNEL = 'sensorFusion:anomaly';

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
    logger.iot?.error('[SensorFusion IPC] 操作失败:', e);
    return { success: false, error: msg };
  }
}

/**
 * 注册 SensorFusion IPC 处理器
 *
 * @param mainWindow 主窗口引用（用于推送异常事件）
 */
export function registerSensorFusionIpc(
  mainWindow: BrowserWindow | null,
): void {
  const service = SensorFusionService.getInstance();

  // ============================================================
  // 生命周期
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}start`, async () => {
    return wrap(() => {
      service.start();
      return true;
    });
  });

  ipcMain.handle(`${IPC_PREFIX}stop`, async () => {
    return wrap(() => service.stop());
  });

  ipcMain.handle(`${IPC_PREFIX}isRunning`, async () => {
    return wrap(() => service.isRunning());
  });

  // ============================================================
  // 配置管理
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}getConfig`, async () => {
    return wrap(() => service.getConfig());
  });

  ipcMain.handle(
    `${IPC_PREFIX}updateConfig`,
    async (_, patch: Partial<SensorFusionConfig>) => {
      return wrap(() => service.updateConfig(patch));
    },
  );

  // 阶段6新增：按实体类型查询有效配置（全局配置与 entityTypeOverrides 合并后）
  ipcMain.handle(
    `${IPC_PREFIX}getEffectiveConfig`,
    async (_, entityType: string) => {
      return wrap(() => service.getEffectiveConfig(entityType));
    },
  );

  // ============================================================
  // 状态与窗口统计查询
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}getStatus`, async () => {
    return wrap(() => service.getStatus());
  });

  ipcMain.handle(`${IPC_PREFIX}listEntityWindowStats`, async () => {
    return wrap(() => service.listEntityWindowStats());
  });

  ipcMain.handle(
    `${IPC_PREFIX}getEntityWindowStats`,
    async (_, externalId: string) => {
      return wrap(() => service.getEntityWindowStats(externalId));
    },
  );

  // ============================================================
  // 异常事件历史查询（阶段7 s7-07 新增）
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}queryAnomalies`,
    async (_, filter: AnomalyEventQueryFilter) => {
      return wrap(() => service.queryAnomalies(filter));
    },
  );

  ipcMain.handle(
    `${IPC_PREFIX}getRecentAnomalies`,
    async (_, limit: number) => {
      return wrap(() =>
        service.getRecentAnomalies(
          typeof limit === 'number' && limit > 0 ? limit : 20,
        ),
      );
    },
  );

  // ============================================================
  // 异常事件订阅：主进程主动推送给渲染层
  // ============================================================

  service.onAnomaly((event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(ANOMALY_CHANNEL, event);
  });

  logger.iot?.info('[SensorFusion IPC] 所有 IPC 处理器已注册');
}

/** 异常事件推送频道名（供 preload API 注册监听时使用） */
export const SENSOR_FUSION_ANOMALY_CHANNEL = ANOMALY_CHANNEL;
