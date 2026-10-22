/**
 * 状态栏部件（statusbar）
 *
 * 直接复用 WorkspaceStatusBar：索引状态、诊断、版本、通知角标等数据都来自
 * store，部件层没有可配置项，因此只做一层转出，不复制内部逻辑。
 */

import WorkspaceStatusBar from '@components/layout/WorkspaceStatusBar'
import type { HostPartComponentProps } from '../HostPartRegistry'

export function StatusbarPart(_props: HostPartComponentProps) {
  return <WorkspaceStatusBar />
}

export default StatusbarPart
