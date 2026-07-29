/**
 * 危险命令模式检测 — shared 单一来源
 *
 * 职责：
 * - 定义危险命令正则模式（rm -rf / curl|sh / sudo / chmod 777 等）
 * - 供主进程安全底线（terminalSandbox 拦截）与渲染进程审批门禁（toolOrchestrator 弹确认）共用
 *
 * 设计原则：
 * - 主进程：命中即硬拦截（安全底线，不可绕过）
 * - 渲染进程：命中则在 dangerous-only 授权方式下弹出 UI 审批
 * - 两层共用同一份模式定义，避免逻辑分裂
 */

/**
 * 危险命令模式列表
 *
 * 命中任一模式即判定为危险命令：
 * - rm -rf /：递归强制删除根目录
 * - wget/curl -O：下载文件到本地
 * - curl|sh / wget|sh：远程脚本执行
 * - powershell encodedCommand：Base64 编码命令（规避检测）
 * - /etc/passwd / /etc/shadow：系统敏感文件
 * - Windows\System32 / registry：Windows 系统目录/注册表
 * - eval()：动态代码执行
 * - chmod 777：危险权限
 * - sudo：提权
 */
export const DANGEROUS_COMMAND_PATTERNS: readonly RegExp[] = [
  /rm\s+-rf\s+.*\//i,                                  // rm -rf /
  /wget\s+.*\s+-O\s+/i,                                // 下载文件
  /curl\s+.*\s+(-o\s+|--output\s+)/i,                  // 下载文件
  /curl\s+.*\|\s*(bash|sh|python|node)/i,              // curl | sh 远程执行
  /wget\s+.*\|\s*(bash|sh|python|node)/i,              // wget | sh 远程执行
  /powershell\s+-e(ncodedCommand)?.*frombase64/i,      // PowerShell 编码命令
  /\/etc\/passwd|\/etc\/shadow/i,                       // 系统敏感文件
  /Windows\\System32/i,                                 // Windows 系统目录
  /registry/i,                                          // 注册表
  /\beval\s*\(/i,                                       // eval 执行
  /\bchmod\s+[0-7]*7[0-7]*\s/i,                         // chmod 危险权限
  /\bsudo\b/i,                                          // sudo 提权
]

/**
 * 检测命令是否命中危险模式
 *
 * @param command 完整命令字符串
 * @returns true 表示命中危险模式，需拦截或审批
 */
export function isDangerousCommand(command: string): boolean {
  if (typeof command !== 'string' || command.length === 0) return false
  return DANGEROUS_COMMAND_PATTERNS.some(pattern => pattern.test(command))
}

/**
 * 检测命令命中的首个危险模式（用于错误提示）
 *
 * @param command 完整命令字符串
 * @returns 命中的正则源码，未命中返回 null
 */
export function matchDangerousCommand(command: string): string | null {
  if (typeof command !== 'string' || command.length === 0) return null
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return pattern.source
    }
  }
  return null
}
