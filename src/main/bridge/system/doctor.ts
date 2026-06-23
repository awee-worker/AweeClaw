/**
 * 诊断工具桥接 — 系统诊断服务的 IPC 接口
 *
 * 职责：
 * - 暴露完整诊断、分类诊断等 IPC 接口
 * - 桥接渲染进程与 DoctorService 模块
 * - 支持按诊断类别（环境、依赖、权限等）独立检测
 */

import { safeIpcHandle } from '../core/ipcGuard'
import { doctorService } from '../../modules/doctor/DoctorService'
import type { DiagnosticCategory } from '../../modules/doctor/DoctorService'

export function registerDoctorHandlers(): void {
  /** 运行完整诊断 */
  safeIpcHandle('doctor:runFullDiagnosis', async () => {
    const report = await doctorService.runFullDiagnosis()
    return { success: true, report }
  })

  /** 运行指定分类诊断 */
  safeIpcHandle('doctor:runCategoryDiagnosis', async (_, category: DiagnosticCategory) => {
    const items = await doctorService.runCategoryDiagnosis(category)
    return { success: true, items }
  })
}
