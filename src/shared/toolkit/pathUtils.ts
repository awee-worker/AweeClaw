/**
 * Path utility functions
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/")
}

export function joinPath(...segments: string[]): string {
  return segments.join("/")
}

export function getRelativePath(from: string, to: string): string {
  return to.startsWith(from) ? to.slice(from.length).replace(/^\//, "") : to
}

export function getFileExtension(path: string): string {
  const lastDot = path.lastIndexOf(".")
  return lastDot >= 0 ? path.slice(lastDot + 1) : ""
}
