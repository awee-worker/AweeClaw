/**
 * 文件编辑工具 — 文件编辑操作与结果类型
 */
export interface FileEdit {
  filePath: string
  oldContent: string
  newContent: string
}

export interface EditResult {
  success: boolean
  error?: string
}

export async function editFile(_edit: FileEdit): Promise<EditResult> {
  return { success: false, error: "Not available in shared toolkit" }
}
