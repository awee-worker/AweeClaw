/**
 * 窗口标题管理 Hook
 *
 * 根据当前激活文件与工作区动态更新窗口标题。
 * 格式: [文件名][修改标记] - [工作区名] - [应用名]
 */

import { useEffect } from 'react'
import { useStore } from '@store'
import { getFileName } from '@shared/toolkit/pathHelper'
import { BRAND } from '@shared/brand'

/** 标题分隔符 */
const TITLE_SEPARATOR = ' - '

/** 已修改标记 */
const DIRTY_MARKER = ' ●'

export function useWindowTitle(): void {
  const activeFilePath = useStore((state) => state.activeFilePath)
  const openFiles = useStore((state) => state.openFiles)
  const workspace = useStore((state) => state.workspace)

  useEffect(() => {
    const parts: string[] = []

    if (activeFilePath) {
      const activeFile = openFiles.find((f) => f.path === activeFilePath)
      const dirtySuffix = activeFile?.isDirty ? DIRTY_MARKER : ''
      parts.push(`${getFileName(activeFilePath)}${dirtySuffix}`)
    }

    if (workspace?.roots?.length) {
      parts.push(getFileName(workspace.roots[0]))
    }

    parts.push(BRAND.name)
    document.title = parts.join(TITLE_SEPARATOR)
  }, [activeFilePath, openFiles, workspace])
}
