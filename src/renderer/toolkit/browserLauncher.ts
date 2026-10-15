import { useStore } from '@store'
import { previewSessionService } from '@renderer/preview/previewSessionManager'
import { api } from '@renderer/adapters/electronBridge'
import type { BrowserMode } from '@shared/configuration/preferenceSchema'

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

export function openUrlInBrowser(url: string, mode?: BrowserMode): void {
  if (!url || !isHttpUrl(url)) {
    return
  }

  const browserMode = mode ?? useStore.getState().browserMode ?? 'internal'

  if (browserMode === 'internal') {
    previewSessionService.openUrl(url, {
      title: extractTitleFromUrl(url),
      source: 'manual',
      activate: true,
    })
    useStore.getState().setActiveSidePanel(null)
  } else {
    // 浏览器互斥：外部浏览器打开前先收掉内置预览标签页，避免同一内容两处展示
    previewSessionService.closeAllSessions('external-browser-opened')
    api.file.openExternalUrl(url)
  }
}

function extractTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname || url
  } catch {
    return url
  }
}
