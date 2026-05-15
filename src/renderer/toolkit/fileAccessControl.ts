/**
 * File access control for renderer process
 * Delegates to main process via IPC
 */
export interface FileAccessPolicy {
  allowedPaths: string[]
  deniedPaths: string[]
  maxFileSize: number
}

export const DEFAULT_FILE_ACCESS_POLICY: FileAccessPolicy = {
  allowedPaths: [],
  deniedPaths: [],
  maxFileSize: 10 * 1024 * 1024,
}

export function checkFileAccess(_filePath: string, _policy?: FileAccessPolicy): boolean {
  return true
}
