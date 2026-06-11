/**
 * Doctor IPC Bridge
 *
 * 为诊断工具模块提供渲染进程调用通道。
 */

import { safeIpcHandle } from './ipcGuard'
import { doctorService } from '../modules/doctor/DoctorService'
import type { DiagnosticCategory } from '../modules/doctor/DoctorService'

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
