/**
 * 编辑器部件（editor）
 *
 * 工作区编辑器 + 底栏。编辑器自己的空状态（EditorWelcome）由 WorkspaceEditor
 * 内部处理，部件层不额外判断有没有打开文件，否则「打开文件」与「显示编辑器」
 * 会变成两套判断依据。
 *
 * 懒加载与崩溃兜底和 MainContentArea 里的 EditorSlot 保持一致，避免同一块
 * 内容因为摆放位置不同而出现两种加载行为。
 */

import { Suspense, lazy } from 'react'
import { CrashGuard as ErrorBoundary } from '@components/foundation/CrashGuard'
import { EditorSkeleton } from '@components/ui/ProgressIndicator'
import type { HostPartComponentProps } from '../HostPartRegistry'

const Editor = lazy(() => import('@components/workspace-editor/WorkspaceEditor'))
const EditorBottomBar = lazy(() => import('@components/layout/EditorBottomBar'))

export function EditorPart(_props: HostPartComponentProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden min-w-0">
      <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden min-w-0">
        <ErrorBoundary>
          <Suspense fallback={<EditorSkeleton />}>
            <Editor />
          </Suspense>
        </ErrorBoundary>
      </div>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <EditorBottomBar />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}

export default EditorPart
