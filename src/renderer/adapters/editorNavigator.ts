interface NavigationTarget {
  filePath: string
  line: number
  col: number
}

interface ResolvedPosition {
  line: number
  col: number
}

let queuedTarget: NavigationTarget | null = null

function normalizeFilePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/([A-Za-z]):/, '$1:').toLowerCase()
}

export function enqueueNavigation(target: NavigationTarget): void {
  queuedTarget = target
}

export function dequeueNavigation(currentFilePath: string): ResolvedPosition | null {
  if (!queuedTarget) return null
  if (normalizeFilePath(queuedTarget.filePath) !== normalizeFilePath(currentFilePath)) return null
  const result: ResolvedPosition = { line: queuedTarget.line, col: queuedTarget.col }
  queuedTarget = null
  return result
}

export function setPendingNavigation(nav: NavigationTarget): void {
  enqueueNavigation(nav)
}

export function consumePendingNavigation(activeFilePath: string): ResolvedPosition | null {
  return dequeueNavigation(activeFilePath)
}
