const AUTO_EXPIRE_MS = 5_000

const trackedPaths = new Map<string, ReturnType<typeof setTimeout>>()

function normalizeKey(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

function stamp(filePath: string): void {
  const key = normalizeKey(filePath)
  const prev = trackedPaths.get(key)
  if (prev) clearTimeout(prev)
  const handle = setTimeout(() => trackedPaths.delete(key), AUTO_EXPIRE_MS)
  trackedPaths.set(key, handle)
}

function checkAndClear(filePath: string): boolean {
  const key = normalizeKey(filePath)
  const handle = trackedPaths.get(key)
  if (handle) {
    clearTimeout(handle)
    trackedPaths.delete(key)
    return true
  }
  return false
}

export const writeOriginTracker = { stamp, checkAndClear }

export const internalWriteTracker = { mark: stamp, consume: checkAndClear }
