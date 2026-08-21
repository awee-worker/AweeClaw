/**
 * 设备 ID 持久化管理
 *
 * 桌面客户端需要一个稳定的设备标识符，用于后端注册和识别。
 * - 首次启动生成 cuid 格式的 ID，存入 configStore
 * - 后续启动复用，保证跨重启稳定
 * - 与后端 Device.deviceId 字段一一对应
 *
 * 使用 configStore 而非 bootstrapStore：deviceId 是用户级配置，
 * 不应随窗口位置等启动期状态一起被重置。
 */
import Store from 'electron-store'
import { randomUUID } from 'crypto'

const DEVICE_ID_KEY = 'device-link.id'

/**
 * 读取或生成稳定的设备 ID
 * @param configStore 应用配置 store
 */
export function getOrCreateDeviceId(configStore: Store<Record<string, unknown>>): string {
  const existing = configStore.get(DEVICE_ID_KEY) as string | undefined
  if (existing && typeof existing === 'string' && existing.length >= 8) {
    return existing
  }
  // 用 randomUUID 生成，去掉连字符后取前 24 位作为 cuid 风格 ID
  const newId = randomUUID().replace(/-/g, '').substring(0, 24)
  configStore.set(DEVICE_ID_KEY, newId)
  return newId
}

/**
 * 清除设备 ID（一般用于用户主动登出后切换账号场景）
 */
export function resetDeviceId(configStore: Store<Record<string, unknown>>): void {
  configStore.delete(DEVICE_ID_KEY)
}
