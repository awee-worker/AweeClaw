/**
 * 自定义协议特权注册（统一入口）
 *
 * 为什么所有 protocol 必须在同一个调用里注册？
 *
 * protocol.registerSchemesAsPrivileged 会把 scheme 的能力写进
 * --fetch-schemes / --cors-schemes / --secure-schemes / --bypass-csp-schemes
 * 等命令行开关，供子进程（渲染进程、工具进程）复用。而这些开关按「开关名 → 值」
 * 存储：同名开关再次写入时旧值被整体替换（Chromium base::CommandLine 的
 * AppendSwitchNative 执行 switches_[key] = value，命令行参数里虽然会叠加多条，
 * 但子进程读到的是最后一条）。
 *
 * 因此把 scheme 拆成多次调用注册时，只有最后一次的 scheme 会传给渲染进程，
 * 先注册的等于没注册，典型症状是渲染进程报：
 *   Fetch API cannot load scenario-bundle://... URL scheme "scenario-bundle" is not supported
 *
 * 结论：全部特权协议在此一次性注册。新增协议时，在协议模块里导出定义常量，
 * 再追加到下面的 PRIVILEGED_SCHEMES，不要各自调用 registerSchemesAsPrivileged。
 *
 * 调用时机：app ready 之前（模块加载阶段），见 appBootstrap.ts。
 */
import { protocol } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { LOCAL_PREVIEW_SCHEME } from './localPreviewProtocol'
import { SCENARIO_BUNDLE_SCHEME } from './scenarioBundleProtocol'
import { PLUGIN_BUNDLE_SCHEME } from './pluginBundleProtocol'
import { VRM_ASSET_SCHEME_DEF } from '../modules/vrm-companion/VrmCompanionStore'

/** registerSchemesAsPrivileged 的单条入参类型 */
export type PrivilegedScheme = Parameters<typeof protocol.registerSchemesAsPrivileged>[0][number]

/** 全部特权协议定义 */
const PRIVILEGED_SCHEMES: PrivilegedScheme[] = [
  LOCAL_PREVIEW_SCHEME,
  SCENARIO_BUNDLE_SCHEME,
  PLUGIN_BUNDLE_SCHEME,
  VRM_ASSET_SCHEME_DEF,
]

let registered = false

/**
 * 一次性注册全部特权协议
 *
 * 必须在 app ready 之前调用，且整个进程只调用一次（重复调用会被忽略并告警）。
 */
export function registerPrivilegedSchemes(): void {
  if (registered) {
    logger.system.warn('[SchemeRegistry] registerPrivilegedSchemes already called, ignored')
    return
  }
  registered = true

  try {
    protocol.registerSchemesAsPrivileged(PRIVILEGED_SCHEMES)
    logger.system.info(
      '[SchemeRegistry] Registered privileged schemes:',
      PRIVILEGED_SCHEMES.map((item) => item.scheme).join(', '),
    )
  } catch (err) {
    logger.system.error('[SchemeRegistry] registerSchemesAsPrivileged failed:', err)
  }
}
