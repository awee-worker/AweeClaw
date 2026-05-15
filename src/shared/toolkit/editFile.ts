/**
 * File editing utilities
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
