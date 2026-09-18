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
 * 命中任一模式即判定为危险命令。
 *
 * ⚠️ 精确性要求（误拦截的代价很高）：命中即「命令被拒绝执行」，AI 只能改用
 * 其它办法或让用户手动执行，用户看到的就是「命令执行失败」。因此每个模式都必须
 * 锚定「真正不可逆 / 提权 / 远程执行」的**具体写法**，不能泛化到日常开发命令。
 * 曾踩过的坑（均已修正，勿回退）：
 *   - `/registry/i` 会把 `npm install --registry=https://registry.npmmirror.com`
 *     这类最常见的国内镜像安装命令一并拦死（命令里出现 registry 就命中）；
 *   - `/rm\s+-rf\s+.*\//i` 会把 `rm -rf node_modules/`、`rm -rf dist/` 拦死；
 *   - `/chmod\s+[0-7]*7[0-7]*\s/i` 会把 `chmod 755 script.sh` 拦死；
 *   - `/curl\s+.*\s+-o\s+/i` 会把 `curl -o ./file url` 这类普通下载拦死。
 */

/** rm 的命令行开关（覆盖 -rf、-r -f、--no-preserve-root 等写法） */
const RM_FLAGS = '(?:--?[A-Za-z-]+\\s+)*'

/** 系统级目录（删除其本身或其直接内容视为不可逆破坏） */
const SYSTEM_DIRS =
  'etc|usr|bin|sbin|var|boot|dev|proc|sys|System|Library|Applications|opt|root|Users'

export const DANGEROUS_COMMAND_PATTERNS: readonly RegExp[] = [
  // 1. 删除根目录 / 家目录 / 当前目录本身
  //    目标必须恰好是 `/`、`/*`、`.`、`..`、`~`、`$HOME` 或盘符根；
  //    `rm -rf node_modules`、`rm -rf dist/`、`rm -rf ./build` 不受影响。
  new RegExp(
    `\\brm\\s+${RM_FLAGS}["']?(?:/\\*?|\\.\\.?|~|\\$\\{?HOME\\}?|[a-zA-Z]:[\\\\/])(?:["']?)(?=\\s|$|["'])`,
    'i',
  ),

  // 2. 删除系统级目录本身或其直接内容（rm -rf /usr、rm -rf /etc/*）
  //    带下级路径（/usr/local/x、/Users/me/project）不在此列，避免误伤。
  new RegExp(
    `\\brm\\s+${RM_FLAGS}["']?/(?:${SYSTEM_DIRS})(?:[\\\\/])?["']?(?=\\s|$|\\*|["'])`,
    'i',
  ),

  // 3. 远程脚本执行：curl / wget 管道进解释器
  /curl\s+[^|]*\|\s*(?:bash|sh|zsh|python\d?|node|perl)\b/i,
  /wget\s+[^|]*\|\s*(?:bash|sh|zsh|python\d?|node|perl)\b/i,

  // 4. 下载文件并写入系统目录（把可执行文件投放到 PATH 上）
  //    仅限系统目录；`curl -o ./x url`、`curl -o /tmp/x url` 不再拦截。
  new RegExp(
    `\\b(?:wget|curl)\\b[^|;&]*?\\s(?:-o|--output|--output-document|-O)\\s+["']?(?:/(?:etc|usr|bin|sbin|var|boot|dev|proc|sys|System|Library|Applications)\\b|[a-zA-Z]:[\\\\/](?:Windows|Program Files|ProgramData)\\b)`,
    'i',
  ),

  // 5. 提权 / 权限失控（chmod 755 不拦，只拦世界可写 777 / 0777 / 7777）
  /\bsudo\b/i,                                            // sudo 提权
  /\bchmod\s+(?:--?[A-Za-z-]+\s+)*(?:[0-7]*777[0-7]?)\b/, // 世界可写权限

  // 6. Shell 动态执行：eval 作为命令出现（源码里 `eval(` 字符串不再误伤）
  /(?:^|[;&|]\s*|\$\(\s*)eval\s+\S/i,

  // 7. 系统敏感文件 / 目录
  /\/etc\/passwd|\/etc\/shadow/i,                       // 系统账号文件
  /Windows\\System32/i,                                 // Windows 系统目录

  // 8. Windows 注册表写入（不再是「命令里出现 registry 就拦」）
  //    npm/yarn/pnpm 的 `--registry=` 镜像源配置属于日常操作，必须放行。
  /\breg(?:\.exe)?\s+(?:add|delete|copy|save|load|restore|import|export|unload)\b/i,
  /\bregedit\b/i,

  // 9. PowerShell 编码命令（Base64 混淆执行）
  /powershell\s+-e(?:ncodedcommand)?\b[^\n]*frombase64/i,
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
