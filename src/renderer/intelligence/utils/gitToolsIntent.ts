/**
 * Git 工具意图识别
 *
 * 用于决定 git_* 工具是否对 LLM 可见。
 *
 * 背景：git_* 工具此前对所有会话无条件可见，AI 在接手开发类任务时会先跑一遍
 * git_status / git_log「探路」。工作区并不都是 Git 仓库，这一步会稳定失败，
 * 既污染上下文，也让用户误以为环境出了问题。
 *
 * 修复策略：
 * - 默认不暴露 git_* 工具；
 * - 仅当用户最新一条消息带有明确的版本控制指令（提交 / 分支 / 合并 / 差异 /
 *   历史 / 拉取推送 / 工作树 / 审计封存等）时才暴露，即由用户在指令中授权。
 */

/** 强信号词：语义上只指向版本控制操作，命中即判定为 Git 指令 */
const GIT_STRONG_WORDS: string[] = [
  'git', '版本控制', '版本管理', '版本库', '代码仓库', '代码库', '仓库状态',
  '初始化仓库', '仓库历史', '仓库日志',
  'commit', '提交记录', '提交历史', '提交信息', '提交说明', '提交日志', '历史提交',
  '回顾提交', '查看提交', '提交明细',
  'branch', '分支', 'merge', 'rebase', '变基', 'cherry-pick', 'cherry pick', '拣选',
  '冲突', 'conflict', '解决冲突',
  'stash', '贮藏', '暂存区', '暂存更改',
  'push', '推送', 'pull', '拉取', 'fetch', '抓取远程', 'clone', '克隆',
  'worktree', '工作树', '审计封存', '审计轨迹',
  'diff', '差异对比', '代码差异', '改动差异',
  'checkout', '切换分支', '新建分支', '创建分支', '删除分支', '当前分支',
  '谁改的', '修改历史', '变更记录', '变更历史', '文件历史', '上一次提交', '上次提交',
  '恢复到上一次提交', '回退到上一次提交',
]

/** 弱信号动作词：单独出现不足以判定（如「合并两个表格」「时间冲突」），需与对象词同时命中 */
const GIT_ACTION_WORDS: string[] = [
  '提交', '暂存', '合并', '回退', '还原', '同步', '恢复', '打标签',
  '拉下来', '推上去', '拉一下', '推一下',
]

/** 弱信号对象词：版本控制的操作对象 */
const GIT_OBJECT_WORDS: string[] = [
  '代码', '改动', '变更', '版本', '仓库', '分支', '提交', '文件', 'diff',
  '说明', '信息', '远端', '远程', '本地',
]

/**
 * 排除语境：这些语境下的「提交 / 合并」等动作与版本控制无关。
 * 仅在无强信号命中时生效，避免「提交订单模块的代码」被整体否定。
 */
const GIT_EXCLUDE_CONTEXTS: string[] = [
  '表单', '订单', '工单', '问卷', '审批流', '报销', '报名',
]

function containsAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word))
}

function containsGitIntent(text: string): boolean {
  if (!text) return false
  const lower = text.toLowerCase()

  // 强信号优先：命中即真，不再看排除语境
  if (containsAny(lower, GIT_STRONG_WORDS)) return true

  if (containsAny(lower, GIT_EXCLUDE_CONTEXTS)) return false

  // 弱信号：动作词 + 对象词双命中
  return containsAny(lower, GIT_ACTION_WORDS) && containsAny(lower, GIT_OBJECT_WORDS)
}

/**
 * 短衔接语：自身不携带任何意图（「好的 / 继续 / 确认」），
 * 常出现在多轮 Git 对话的确认回合，需要沿用上一轮的判定结论
 */
const SHORT_CONNECTOR_WORDS: string[] = [
  '好的', '好', '行', '可以', '嗯', '是的', '对', '继续', '确认', '确定',
  '同意', '允许', '提交吧', '就这样', 'ok', 'okay', 'yes', 'go ahead',
]

/** 短衔接语的最大长度：超过则视为正常语句，按自身文本判定 */
const SHORT_CONNECTOR_MAX_LENGTH = 8

/** 历史回溯窗口：只回看最近若干条用户消息，避免一次提及后长期保持可见 */
const HISTORY_LOOKBACK = 3

function isShortConnector(text: string): boolean {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed || trimmed.length > SHORT_CONNECTOR_MAX_LENGTH) return false
  return containsAny(trimmed, SHORT_CONNECTOR_WORDS)
}

/** 从历史消息中回看是否存在 Git 指令（不含当前这条） */
function hasGitIntentInHistory(history: string[]): boolean {
  return history.slice(-HISTORY_LOOKBACK).some((item) => containsGitIntent(item))
}

/**
 * 判断一条用户消息是否为「Git 操作」指令
 *
 * @param text 用户最新消息文本（可为空）
 * @param fallbackHistory 此前的用户消息：当前消息为「好的 / 继续 / 确认」这类
 *   短衔接语时，沿用最近一轮的判定结论，避免多轮 Git 对话被中途掐断
 */
export function isGitToolsIntent(text?: string | null, fallbackHistory?: string[]): boolean {
  const value = typeof text === 'string' ? text : ''
  if (containsGitIntent(value)) return true
  if (!isShortConnector(value)) return false
  return hasGitIntentInHistory(fallbackHistory || [])
}

/**
 * 从 LLM 消息数组中提取用户文本并做 Git 意图判定
 * 供工具加载上下文（getToolsForContext）使用
 */
export function isGitToolsIntentFromMessages(
  messages?: Array<{ role?: string; content?: unknown }>,
): boolean {
  if (!messages || messages.length === 0) return false

  const userTexts: string[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role !== 'user') continue
    const content = msg.content
    if (typeof content === 'string') {
      userTexts.unshift(content)
    } else if (Array.isArray(content)) {
      const text = content
        .filter((p): p is { type: string; text?: string } => !!p && typeof p === 'object' && (p as { type?: string }).type === 'text')
        .map((p) => p.text || '')
        .join('')
      if (text) userTexts.unshift(text)
    }
  }

  const latest = userTexts[userTexts.length - 1] || ''
  return isGitToolsIntent(latest, userTexts.slice(0, -1))
}

