/**
 * 预览发现提示 Hook
 *
 * 在工作区根目录就绪后，延迟初始化预览发现服务。
 */

import { useEffect, useMemo } from 'react'
import { useStore } from '@store'
import { logger } from '@shared/toolkit/LogEngine'

/** 空根目录常量，避免每次渲染创建新数组 */
const EMPTY_ROOTS: string[] = []

/** 延迟初始化时间（毫秒） */
const DISCOVERY_DELAY_MS = 1200

export function usePreviewDiscoveryToasts(active: boolean): void {
  const roots = useStore((state) => state.workspace?.roots ?? EMPTY_ROOTS)
  const rootsKey = roots.join('|')
  const workspaceRoots = useMemo(() => roots.slice(), [rootsKey])

  useEffect(() => {
    if (!active || workspaceRoots.length === 0) return

    let cancelled = false

    const timer = window.setTimeout(() => {
      void import('@renderer/preview/previewPromptBuilder')
        .then(({ previewPromptService }) => {
          if (cancelled) return
          previewPromptService.setWorkspaceRoots(workspaceRoots)
        })
        .catch((error) => {
          logger.ui.error('[Preview] Failed to initialize discovery toasts', error)
        })
    }, DISCOVERY_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, rootsKey, workspaceRoots])
}
