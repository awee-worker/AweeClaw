/**
 * 文件变更工具模块
 * 提供行数变化计算等辅助功能
 */

import * as Diff from 'diff'

/**
 * 计算两个文本之间的行数变化
 * 使用 diff 库（Myers 算法）计算精确的增加和删除行数
 */
export function calculateLineChanges(
    oldContent: string,
    newContent: string
): { added: number; removed: number } {
    const changes = Diff.diffLines(oldContent, newContent)
    
    let added = 0
    let removed = 0
    
    for (const change of changes) {
        // 计算实际行数（排除末尾空行）
        const lines = change.value.split('\n')
        const lineCount = change.value.endsWith('\n') ? lines.length - 1 : lines.length
        
        if (change.added) {
            added += lineCount
        } else if (change.removed) {
            removed += lineCount
        }
    }

    return { added, removed }
}
