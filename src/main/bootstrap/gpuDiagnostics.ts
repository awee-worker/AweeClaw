/**
 * GPU 渲染路径诊断
 *
 * Chromium 在显卡驱动不达标时会静默回退到 SwiftShader 软件渲染。这种回退
 * 不会报错、不会崩溃，界面上看不出来，唯一的症状是「同一份代码在 A 机器流畅、
 * 在 B 机器 CPU 翻倍」—— 3D 桌面伴侣与透明窗口的合成开销会被放大到完全不同的量级。
 *
 * getAppMetrics 只能看到「GPU 进程存在」，看不到它是否真的具备加速能力
 * （软件渲染同样会起一个 GPU 进程）。因此需要在启动后单独查询一次特征状态，
 * 把真实后端落进日志，事后排查 CPU 异常时才有据可依。
 *
 * @module bootstrap/gpuDiagnostics
 */

import { app } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

/**
 * 真正决定本应用主路径（3D 角色 / 透明窗口 / 图表）是否走硬件的特征项。
 *
 * 不取全量 feature status：video_decode、video_encode 这类与播放解码相关，
 * 缺失它们不会让渲染变慢，全量输出只会在日志里制造噪音。
 */
const CRITICAL_FEATURES = ['gpu_compositing', 'webgl', 'webgl2'] as const

/**
 * 判定为软件路径的状态值。
 *
 * `disabled_software` 与 `software_only` 都表示最终落到了软件实现；
 * `unavailable_software` 另说 —— 它意味着硬件与软件都不可用，属于更严重的
 * 异常，单独归入告警而不与「主动回退」混为一谈。
 */
const SOFTWARE_ONLY_STATUSES = new Set(['software_only', 'disabled_software'])
const UNAVAILABLE_STATUSES = new Set(['unavailable_software', 'disabled_off'])

/** 应用级监听只注册一次：反复创建窗口不应重复查询、重复刷屏 */
let gpuDiagnosticsRegistered = false

/** getGPUFeatureStatus 的返回是 { 特征名: 状态字符串 } */
type GpuFeatureStatus = Record<string, string>

/**
 * 读取并记录当前 GPU 渲染路径。
 *
 * 调用时机有约束：必须在 app ready 之后，ready 之前查询拿到的是空表，
 * 会得出「所有特征都缺失」的错误结论。
 */
async function reportGpuStatus(reason: string): Promise<boolean> {
  let featureStatus: GpuFeatureStatus
  try {
    featureStatus = app.getGPUFeatureStatus() as unknown as GpuFeatureStatus
  } catch (err) {
    logger.system.warn('[GPU] getGPUFeatureStatus 不可用:', err)
    return false
  }

  if (!featureStatus || Object.keys(featureStatus).length === 0) {
    logger.system.warn('[GPU] 特征状态为空，无法判定渲染路径', { reason })
    return false
  }

  const critical: Record<string, string> = {}
  for (const name of CRITICAL_FEATURES) {
    critical[name] = featureStatus[name] ?? 'unknown'
  }

  const softwareFeatures = CRITICAL_FEATURES.filter((name) =>
    SOFTWARE_ONLY_STATUSES.has(critical[name] ?? ''),
  )
  const unavailableFeatures = CRITICAL_FEATURES.filter((name) =>
    UNAVAILABLE_STATUSES.has(critical[name] ?? ''),
  )

  // 驱动信息只在疑似软件渲染时才取：getGPUInfo 需要跨进程往返，
  // 正常路径上没有必要为一条日志付这笔开销。
  const suspectsSoftware = softwareFeatures.length > 0 || unavailableFeatures.length > 0
  const driver = suspectsSoftware ? await readDriverInfo() : null

  const payload = {
    reason,
    critical,
    featureStatus,
    softwareFeatures,
    unavailableFeatures,
    platform: process.platform,
    driver,
  }

  if (unavailableFeatures.length > 0) {
    logger.system.error('[GPU] 关键渲染特征不可用，界面可能异常', payload)
    return true
  }

  if (softwareFeatures.length > 0) {
    logger.system.warn(
      '[GPU] 已回退到软件渲染（SwiftShader），CPU 占用将显著高于硬件加速。' +
        '常见成因：显卡驱动过旧 / 虚拟机或远程桌面环境 / 显卡被系统禁用',
      payload,
    )
    return true
  }

  // 合成器尚未出过帧时特征状态会短暂为 unknown，此时下结论会得到一份假的「全部正常」
  if (CRITICAL_FEATURES.some((name) => critical[name] === 'unknown')) {
    return false
  }

  // 正常路径只记一行摘要，避免把整份 featureStatus 写进每台机器的日志
  logger.system.info('[GPU] 硬件加速生效', {
    reason,
    critical,
    platform: process.platform,
  })
  return true
}

/**
 * 读取显卡厂商与型号，用于判断「是否已知的驱动问题机型」。
 *
 * 取 basic 级别即可满足归因；full 会附带大量驱动内部字段，
 * 且在不同平台上耗时差异很大，不适合启动阶段同步等待。
 */
async function readDriverInfo(): Promise<Record<string, string> | null> {
  try {
    const info = (await app.getGPUInfo('basic')) as {
      gpuDevice?: Array<{ vendorId?: number; deviceId?: number; vendorString?: string; driverVendor?: string; driverVersion?: string }>
    }
    const device = info?.gpuDevice?.[0]
    if (!device) return null

    return {
      vendorString: device.vendorString ?? '',
      vendorId: device.vendorId !== undefined ? String(device.vendorId) : '',
      deviceId: device.deviceId !== undefined ? String(device.deviceId) : '',
      driverVendor: device.driverVendor ?? '',
      driverVersion: device.driverVersion ?? '',
    }
  } catch (err) {
    logger.system.warn('[GPU] getGPUInfo 不可用:', err)
    return null
  }
}

/**
 * 注册 GPU 诊断（应用级，幂等）。
 *
 * 除启动时的初次检测外，还在 GPU 进程非正常退出后重新检测一次：
 * 进程崩溃后 Chromium 可能永久切到软件渲染直到下次启动，
 * 只看启动日志会把这种「中途降级」误判为「本机一直是软件渲染」。
 */
export function registerGpuDiagnostics(): void {
  if (gpuDiagnosticsRegistered) return
  gpuDiagnosticsRegistered = true

  /** 是否已因「无法判定」补查过一次，防止在异常环境下反复重试 */
  let retried = false

  const detect = (reason: string): void => {
    void reportGpuStatus(reason).then((conclusive) => {
      if (conclusive || retried) return
      retried = true
      // 首个窗口刚建好时合成器可能还没出过帧，特征状态会短暂为 unknown；
      // 延迟复查一次，避免把「尚未就绪」记成「路径未知」而漏掉软件渲染告警
      setTimeout(() => void reportGpuStatus(`${reason}:retry`), 800)
    })
  }

  if (app.isReady()) {
    detect('ready')
  } else {
    app.whenReady().then(() => detect('ready'))
  }

  app.on('child-process-gone', (_event, details) => {
    if (details.type !== 'GPU') return
    // 崩溃后 Chromium 会重建 GPU 进程，新进程的渲染路径可能已经改变
    detect(`gpu-process-gone:${details.reason}`)
  })
}
