/**
 * 命令风险分级
 *
 * 定位：审批门禁的命令侧判定。回答的不是「这条命令是否危险」
 * （那是 @shared/configuration/dangerousCommands 的职责，命中即硬拦截），
 * 而是「这条命令是否值得让用户确认一次」。
 *
 * 分三级：
 * - blocked：命中危险命令模式。主进程终端沙箱与工具层都会拒绝执行，
 *   审批只是为了把命令摆到用户面前，用户即便批准也无法执行
 * - review：未命中危险模式，但属于不可逆破坏的常见写法
 *   （git reset --hard、递归删除家目录等）。这类命令会被正常执行，
 *   所以必须在执行前确认一次
 * - safe：两种都不命中
 *
 * 为什么不与危险模式合并定义：
 * 危险模式位于 shared 层，主进程安全底线与渲染进程共用同一份定义。
 * 一旦把「可能危险」的灰区写法混进去，日常操作会被硬拦截，且用户无法通过
 * 审批覆盖——这正是历史上 4 次误拦截事故的成因。灰区只在渲染进程门禁使用，
 * 用户批准后命令照常执行，因此可以放宽；但放宽仍要克制，每多一条规则就多一次
 * 无谓的点击。
 *
 * 灰区的筛选标准是「不可逆」而非「看起来吓人」：
 * 删除文件、丢弃未提交改动、重写远端历史、清空数据属于前者；
 * 改权限、重命名、改配置属于后者，均可恢复，因此不入灰区。
 *
 * 判定全程为同步模式匹配，不引入模型调用：审批门禁位于工具执行链路，
 * 每批工具都会经过，任何模型调用都会直接叠加到工具启动延迟上。
 */

import { matchDangerousCommand } from '@shared/configuration/dangerousCommands'

/** 命令风险级别 */
export type CommandRiskLevel = 'blocked' | 'review' | 'safe'

/** 分级结果 */
export interface CommandRiskAssessment {
  level: CommandRiskLevel
  /** 置信度 0~1，用于识别「拿不准」，不作概率使用 */
  confidence: number
  /** 判定理由，用于审批展示与审计 */
  rationale: string
  /** 命中的灰区规则 id（level 为 review 时有值） */
  ruleId?: string
  /** 命中的危险模式源码（level 为 blocked 时有值） */
  pattern?: string
}

/**
 * 可重建的临时目录前缀
 *
 * 这些位置的文件本来就是过程产物，清理它属于日常操作，不触发确认。
 */
const TEMPORARY_PATH_PREFIXES = [
  '/tmp/',
  '/private/tmp/',
  '/var/tmp/',
  '/var/folders/',
]

function isTemporaryPath(target: string): boolean {
  return TEMPORARY_PATH_PREFIXES.some((prefix) => target.startsWith(prefix))
}

/**
 * 取出命令中出现的绝对路径与家目录路径
 *
 * 只按 token 切分，不做 shell 解析：这里只需要知道命令是否触及工作区之外的
 * 位置，不需要精确还原参数结构，过度解析反而会引入新的错误来源。
 */
function extractSensitivePaths(command: string): string[] {
  const tokens = command.match(/(?:^|[\s"'=])(~\/[^\s"';&|]*|\/[^\s"';&|]*)/g) ?? []
  return tokens
    .map((token) => token.replace(/^[\s"'=]+/, ''))
    .filter((token) => token.length > 1)
}

/** 一条灰区规则 */
interface ReviewRule {
  id: string
  /** 为什么这类命令需要确认（会展示在审批理由中） */
  reason: string
  /** 是否命中该规则 */
  match: (command: string) => boolean
}

/**
 * 灰区规则表
 *
 * 维护约定：新增规则前先确认「误伤成本」——命中即弹一次确认框，
 * 若某类写法在日常开发中出现频率高、且后果可恢复，就不要收进来。
 */
const REVIEW_RULES: readonly ReviewRule[] = [
  {
    id: 'rm-sensitive-path',
    reason: '删除家目录或绝对路径下的文件，误删后难以恢复',
    match: (command) =>
      /\brm\b/.test(command) &&
      extractSensitivePaths(command).some((target) => !isTemporaryPath(target)),
  },
  {
    id: 'rm-glob',
    reason: '删除目标含通配符，实际删除范围取决于展开结果',
    match: (command) => /\brm\b[^|;&\n]*[\s"'=][^\s"';&|]*[*?]/.test(command),
  },
  {
    id: 'find-delete',
    reason: '按条件批量删除文件（find -delete 或 -exec rm）',
    match: (command) =>
      /\bfind\b[^|;&\n]*\s-delete\b/.test(command) ||
      /\bfind\b[^|;&\n]*-exec\s+rm\b/.test(command),
  },
  {
    id: 'xargs-rm',
    reason: '把上游输出交给 rm 批量删除',
    match: (command) => /\bxargs\b[^|;&\n]*\brm\b/.test(command),
  },
  {
    id: 'git-reset-hard',
    reason: 'git reset --hard 会丢弃尚未提交的改动',
    match: (command) => /\bgit\s+reset\b[^|;&\n]*--hard\b/.test(command),
  },
  {
    id: 'git-discard-changes',
    reason: 'checkout / restore / switch 的丢弃写法会覆盖工作区改动',
    match: (command) =>
      /\bgit\s+checkout\s+--\s+\S/.test(command) ||
      /\bgit\s+checkout\s+(?:--\s+)?\.(?:\s|$)/.test(command) ||
      /\bgit\s+checkout\b[^|;&\n]*\s-f\b/.test(command) ||
      /\bgit\s+restore\b[^|;&\n]*(?:\s\.(?:\s|$)|--worktree)/.test(command) ||
      /\bgit\s+switch\b[^|;&\n]*--discard-changes/.test(command),
  },
  {
    id: 'git-clean-force',
    reason: 'git clean 的 -f 写法会删除未跟踪文件，这些文件不在版本库里',
    match: (command) => /\bgit\s+clean\b[^|;&\n]*\s-[a-zA-Z]*f/.test(command),
  },
  {
    id: 'git-branch-force-delete',
    reason: '强制删除分支，分支上的提交只能靠 reflog 找回',
    match: (command) => /\bgit\s+branch\b[^|;&\n]*\s-D\b/.test(command),
  },
  {
    id: 'git-stash-drop',
    reason: '丢弃暂存的改动',
    match: (command) => /\bgit\s+stash\s+(?:drop|clear)\b/.test(command),
  },
  {
    id: 'git-history-rewrite',
    reason: '重写提交历史，会影响所有已拉取该分支的仓库',
    match: (command) =>
      /\bgit\s+(?:filter-branch|filter-repo)\b/.test(command) ||
      /\bgit\s+reflog\s+expire\b/.test(command),
  },
  {
    id: 'destructive-write',
    reason: '直接写入磁盘设备或清空文件内容',
    match: (command) =>
      /\bdd\b[^|;&\n]*\b(?:if|of)=/.test(command) ||
      /\btruncate\b/.test(command) ||
      /\bshred\b/.test(command) ||
      /\bmkfs(?:\.\w+)?\b/.test(command) ||
      /\bdiskutil\s+erase/.test(command),
  },
  {
    id: 'process-mass-kill',
    reason: '按名称批量结束进程，可能命中同名进程',
    match: (command) => /\b(?:killall|pkill)\b/.test(command),
  },
  {
    id: 'storage-destructive-sql',
    reason: '数据定义或全表删除语句，执行后无法回滚',
    match: (command) =>
      /\bdrop\s+(?:table|database|schema)\b/i.test(command) ||
      /\btruncate\s+table\b/i.test(command) ||
      /\bdelete\s+from\b(?![^;\n]*\bwhere\b)/i.test(command),
  },
  {
    id: 'rsync-delete',
    reason: 'rsync --delete 会删除目标端多余文件',
    match: (command) => /\brsync\b[^|;&\n]*--delete\b/.test(command),
  },
  {
    id: 'system-power',
    reason: '关机、重启或停止系统服务会中断正在进行的工作',
    match: (command) =>
      /\b(?:shutdown|reboot|poweroff|halt)\b/.test(command) ||
      /\bsystemctl\s+(?:stop|disable|mask)\b/.test(command) ||
      /\blaunchctl\s+(?:unload|bootout|remove)\b/.test(command),
  },
]

/** 危险模式命中的置信度：正则为人工锚定的具体写法，命中即确定 */
const BLOCKED_CONFIDENCE = 0.98

/** 灰区命中的置信度：模式明确，但「是否需要确认」含主观成分 */
const REVIEW_CONFIDENCE = 0.8

/** 未命中任何规则的置信度：结论来自「没有证据」而非「有反证」 */
const SAFE_CONFIDENCE = 0.85

/**
 * 对一条命令做风险分级
 *
 * 判定顺序固定：先危险模式（硬拦截层），再灰区规则。顺序不可交换——
 * 灰区规则中的 rm 相关条目只看路径，若不先判危险模式，
 * `rm -rf /` 会被降级成「待确认」，而它实际上是不可执行的。
 */
export function assessCommandRisk(command: string): CommandRiskAssessment {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return { level: 'safe', confidence: 0.5, rationale: '命令为空，无需判定' }
  }

  const blockedPattern = matchDangerousCommand(command)
  if (blockedPattern) {
    return {
      level: 'blocked',
      confidence: BLOCKED_CONFIDENCE,
      rationale: `命中危险模式：${blockedPattern}`,
      pattern: blockedPattern,
    }
  }

  for (const rule of REVIEW_RULES) {
    try {
      if (rule.match(command)) {
        return {
          level: 'review',
          confidence: REVIEW_CONFIDENCE,
          rationale: `命中待确认规则：${rule.reason}`,
          ruleId: rule.id,
        }
      }
    } catch {
      // 单条规则异常不应影响整体判定，跳过继续
    }
  }

  return {
    level: 'safe',
    confidence: SAFE_CONFIDENCE,
    rationale: '未命中危险模式与待确认规则',
  }
}

/**
 * 该命令是否需要用户确认
 *
 * 审批门禁的调用入口。blocked 与 review 都需要把命令摆到用户面前：
 * 前者让用户有机会拒绝一个本就会失败的操作，后者才是本模块的主要收益。
 */
export function needsCommandApproval(command: string): boolean {
  return assessCommandRisk(command).level !== 'safe'
}

/** 灰区规则清单（只读，供评测与排查使用） */
export function listReviewRuleIds(): string[] {
  return REVIEW_RULES.map((rule) => rule.id)
}
