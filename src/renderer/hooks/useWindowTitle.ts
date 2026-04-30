/**
 * 窗口标题管理 Hook
 * 动态更新窗口标题，显示当前文件和工作区信息
 * 格式: [文件名] [修改标记] - [工作区名] - AweeClaw
 */

import { useEffect } from 'react'
import { useStore } from '@store'
import { getFileName } from '@shared/utils/pathUtils'

export function useWindowTitle() {
  const activeFilePath = useStore((state) => state.activeFilePath)
  const openFiles = useStore((state) => state.openFiles)
  const workspace = useStore((state) => state.workspace)

  useEffect(() => {
    const parts: string[] = []

    // 1. 当前文件名 + 修改标记
    if (activeFilePath) {
      const activeFile = openFiles.find((f) => f.path === activeFilePath)
      const fileName = getFileName(activeFilePath)
      const isDirty = activeFile?.isDirty ? ' ●' : ''
      parts.push(`${fileName}${isDirty}`)
    }

    // 2. 工作区名称
    if (workspace && workspace.roots && workspace.roots.length > 0) {
      const workspaceName = getFileName(workspace.roots[0])
      parts.push(workspaceName)
    }

    // 3. 应用名称
    parts.push('AweeClaw')

    // 设置标题
    document.title = parts.join(' - ')
  }, [activeFilePath, openFiles, workspace])
}
