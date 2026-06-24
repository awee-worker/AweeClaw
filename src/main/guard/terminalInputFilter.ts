/**
 * 终端输入过滤器 — 规范化管道输入
 *
 * 职责：
 * - 规范化终端输入的换行符（\r\n / \r → \n）
 * - 保留 Ctrl+C（ASCII 3）等控制字符
 */

export function normalizePipeTerminalInput(data: string): string {
  if (data === String.fromCharCode(3)) {
    return data
  }

  return data.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}
