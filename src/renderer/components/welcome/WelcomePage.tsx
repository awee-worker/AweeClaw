/**
 * WelcomePage — 工作台首页入口（薄封装）
 *
 * 实际内容已迁移至 WorkbenchHome，此处保留文件名与默认导出，
 * 兼容 MainContentArea / AweeApp 的懒加载引入点。
 */

import WorkbenchHome from '@components/workbench/WorkbenchHome'

export default function WelcomePage() {
  return <WorkbenchHome />
}
