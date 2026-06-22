/**
 * 系统信息查询器（L3）
 * 封装平台适配器，提供 CPU/内存/磁盘/网络/电源等查询能力
 */

import type { PlatformAdapter } from './platform/types'
import type { SystemInfo, ActionResult } from './types/actions'

export class SystemInfoService {
  constructor(private adapter: PlatformAdapter) {}

  /** 获取完整系统信息 */
  async getInfo(): Promise<SystemInfo> {
    return this.adapter.getSystemInfo()
  }

  /** 设置系统音量（0-100） */
  async setVolume(volume: number): Promise<ActionResult> {
    return this.adapter.setVolume(volume)
  }

  /** 设置屏幕亮度（0-100） */
  async setBrightness(level: number): Promise<ActionResult> {
    return this.adapter.setBrightness(level)
  }
}
