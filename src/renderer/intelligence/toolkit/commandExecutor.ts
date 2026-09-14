import { platform as runtimePlatform } from '@shared/toolkit/pathHelper'

/**
 * 长运行命令匹配模式
 *
 * 包含两类：
 * 1. 持续运行的服务类命令（dev server、watch 等）— 永不退出
 * 2. 耗时较长的安装/构建命令（install、ci、build 等）— 可能耗时数分钟
 *    这类命令不作为后台进程，但需要更长的超时时间
 *
 * 匹配规则说明：
 * - 命令分隔符（&&/;/||）后匹配具体命令，支持 `cd xxx && python3 -m http.server` 形式
 * - python 版本号兼容：python、python3、python3.11、python3.12 等均匹配
 * - 包含常见静态服务器、开发服务器、文件监听、数据库服务等持续运行进程
 * - `--watch`/`--serve`/`-w` 等持续监听标志单独匹配（tsc --watch、sass --watch 等）
 */
export const LONG_RUNNING_COMMAND_PATTERN = /(?:^|&&|;|\|\|)\s*(?:(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:dev|start|serve|serve:|watch)|python\d*(?:\.\d+)*\s+-m\s+(?:http\.server|flask|werkzeug|gunicorn)|uvicorn|nodemon|webpack(?:-dev-server)?|vite|http-server|live-server|serve\s+-s|json-server|php\s+-S|ruby\s+-runhttpd|docker\s+(?:compose\s+)?up|kubectl\s+port-forward|minio\s+server|redis-server|tailwindcss\s+--watch)|\s--watch(?:\s|$)|\s--serve(?:\s|$)/

/**
 * 安装/构建类耗时命令模式
 *
 * 这些命令不是持续运行的服务，但通常耗时较长（数十秒到数分钟），
 * 需要更长的超时时间。匹配后使用 EXTENDED_TIMEOUT_MS 作为超时。
 *
 * 覆盖范围：
 * - Node 生态：npm/yarn/pnpm/bun install|ci|add|build|test|lint
 * - Python 生态：pip/pip3/python -m pip install（numpy/scipy 等大包耗时极长）
 * - Rust：cargo build|test|mod
 * - Go：go build|test|mod
 * - 系统包管理：apt/apt-get/dpkg install、brew install、yum/dnf install、pacman -S
 * - 容器构建：docker build、docker-compose build
 * - 通用构建：make、cmake、ninja
 *
 * 正则特性：
 * - 使用 (?:^|&&|;|\|\|)\s* 前缀匹配命令分隔符后的子命令
 *   支持 `cd xxx && pip install xxx`、`A && B && npm install` 等组合形式
 * - python 版本号兼容：python、python3、python3.11、python3.12 等都匹配
 * - pip 和 pip3 都兼容
 */
export const EXTENDED_TIMEOUT_COMMAND_PATTERN = /(?:^|&&|;|\|\|)\s*(?:(?:npm|yarn|pnpm|bun)\s+(?:install|ci|i|add|install-save|install-save-dev)\b|(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:build|test|tsc|lint)\b|pip3?\s+install\b|python\d*(?:\.\d+)*\s+-m\s+pip\s+install\b|(?:cargo|go)\s+(?:build|test|mod)\b|(?:apt|apt-get)\s+(?:install|update|upgrade)\b|aptitude\s+install\b|brew\s+(?:install|upgrade|reinstall)\b|(?:yum|dnf)\s+(?:install|upgrade)\b|pacman\s+-S\b|docker\s+(?:build|compose\s+build)\b|make\b|cmake\b|ninja\b)/

/** 安装/构建类命令的扩展超时时间（10 分钟）
 *
 * 5 分钟在弱网或 scipy/numpy 等大包+编译场景下仍会超时。
 * 提升到 10 分钟，覆盖绝大多数安装场景，同时仍保留超时兜底防止命令卡死。
 */
export const EXTENDED_TIMEOUT_MS = 600000

/** 普通命令的默认超时时间（2 分钟）
 *
 * 为什么是 2 分钟而不是 10 分钟：
 * - 此前 run_command 对所有命令统一使用 EXTENDED_TIMEOUT_MS（10 分钟），
 *   导致 `find / -name xxx`、全盘 grep 等「扫描范围过大」的命令会让 AI 干等数分钟，
 *   用户看到的现象就是「命令一直在执行、三四百秒还没结束」。
 * - 绝大多数普通命令应在秒级返回；2 分钟足以覆盖大目录遍历、慢编译等常见场景。
 * - 确实需要更长时间的命令（安装 / 构建 / 测试）由 EXTENDED_TIMEOUT_COMMAND_PATTERN 单独识别。
 * - 需要长时间运行的服务/脚本请使用 is_background=true，走后台通道不受此超时限制。
 */
export const DEFAULT_TIMEOUT_MS = 120000

/** 全盘扫描类命令的短超时（60 秒）
 *
 * `find / ...`、`grep -r xxx /`、`du -sh /`、`locate` 等从根目录 / 家目录开始递归遍历的命令，
 * 在 macOS 上需要进入 /System、/Applications、/Library 等数十万文件，即便给足 120s 也几乎必然超时。
 * 与其让 AI 干等，不如 60s 快速失败，并把「缩小搜索范围」的诊断返回给 AI，
 * 让 AI 立刻改用限定在工作区目录的写法重试。
 */
export const BROAD_SCAN_TIMEOUT_MS = 60000

export type InteractiveTerminalBackend = 'pty' | 'pipe'

const currentPlatform: NodeJS.Platform = runtimePlatform.isWindows ? 'win32' : runtimePlatform.isMac ? 'darwin' : 'linux'

/**
 * 纯文本匹配：命令是否命中「持续运行的服务进程」关键词
 *
 * 只做文本匹配，不含 is_background / 结尾 `&` 等「显式后台意图」判断。
 * 调用方需要区分「命令文本本身是长进程」和「调用方要求后台执行」时可单独使用。
 */
export function matchesLongRunningCommand(command: string): boolean {
  return LONG_RUNNING_COMMAND_PATTERN.test(command.trim())
}

/**
 * 检测命令是否以未转义的 `&` 结尾（shell 的「后台执行」操作符）
 *
 * 这类命令会把整条命令丢到后台并立刻返回提示符，属于**显式的后台意图**，必须走
 * 长进程/后台通道立即返回：
 * - 若误走 sentinel 等待通道，包裹后的命令会变成 `... &; printf END`，
 *   在 bash / sh 下是语法错误 → 命令根本不执行、END sentinel 永远不输出，
 *   工具只能靠超时兜底（最长 10 分钟），表现为「命令一直在执行、拿不到结果」。
 * - zsh 恰好接受 `&;`，所以同一条命令在不同用户机器上时好时坏。
 */
export function hasTrailingBackgroundOperator(command: string): boolean {
  return /(?:[^&\\]|^)&\s*$/.test(command.trim())
}

export function isLongRunningCommand(command: string, isBackground = false): boolean {
  return Boolean(isBackground)
    || hasTrailingBackgroundOperator(command)
    || matchesLongRunningCommand(command)
}

/** 命令是否命中「安装 / 构建 / 测试」类长耗时模式（使用 EXTENDED_TIMEOUT_MS） */
export function matchesExtendedTimeoutCommand(command: string): boolean {
  return EXTENDED_TIMEOUT_COMMAND_PATTERN.test(command.trim())
}

/**
 * 检测「全盘 / 大范围扫描」类命令
 *
 * 这类命令的判定要同时满足两点，避免误伤正常命令：
 * 1. 命令是扫描/遍历类：find / grep -r / rg / du / locate / mdfind / fd
 * 2. 扫描目标落在文件系统根、家目录或系统级目录，而不是工作区里的相对路径
 *    （例如 `find . -name x`、`grep -r foo ./src` 都不算大范围扫描）
 *
 * 若命令中显式出现了工作区绝对路径，说明 AI 已限定范围，也不按大范围扫描处理。
 */
export function matchesBroadScanCommand(command: string, workspacePath?: string): boolean {
  const cmd = command.trim()
  // 1. 必须是扫描/遍历类命令（含分隔符后的子命令）
  if (!/(?:^|&&|;|\|\||\|)\s*(?:find|grep|rg|ag|du|locate|mdfind|fd)\b/.test(cmd)) {
    return false
  }
  // 2. 已显式限定在工作区目录内 → 不算大范围扫描
  if (workspacePath && cmd.includes(workspacePath)) {
    return false
  }
  // 3. 目标为根目录 / 家目录 / 系统级目录
  //    要求 "/" 前后是空白、引号或行边界（排除 ./src、a/b 这类相对路径里的斜杠）
  return /(?:^|\s|["'])(?:\/|~\/|\/Users|\/System|\/Library|\/Applications|\/opt|\/var|\/etc)(?:\s|$|["']|\/)/.test(cmd)
}

/**
 * 命令超时解析（分层策略）
 *
 * - 长进程 / 显式后台 → 0（不设超时；run_command 会走 detached 通道立即返回，不会进入等待）
 * - 安装 / 构建 / 测试类 → EXTENDED_TIMEOUT_MS（10 分钟）
 * - 全盘 / 大范围扫描类 → BROAD_SCAN_TIMEOUT_MS（60 秒，快速失败并给出诊断）
 * - 其余命令 → DEFAULT_TIMEOUT_MS（2 分钟）
 *
 * 这样把「所有命令都可能等 10 分钟」收敛为「只有构建类才等 10 分钟」，
 * 从根上消除「命令一直在执行、AI 长时间卡住」的问题。
 */
export function resolveCommandTimeout(
  command: string,
  options?: { isLongRunning?: boolean; workspacePath?: string },
): number {
  if (options?.isLongRunning) return 0
  if (matchesExtendedTimeoutCommand(command)) return EXTENDED_TIMEOUT_MS
  if (matchesBroadScanCommand(command, options?.workspacePath)) return BROAD_SCAN_TIMEOUT_MS
  return DEFAULT_TIMEOUT_MS
}

export function getInteractiveTerminalBackend(
  platform: NodeJS.Platform = currentPlatform,
): InteractiveTerminalBackend {
  return platform === 'darwin' ? 'pipe' : 'pty'
}
