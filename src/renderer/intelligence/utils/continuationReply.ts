/**
 * 「继续执行剩余任务」卡片的续接文案构造
 *
 * 卡片本身只是把未完成清单结构化地展示出来；真正让 AI 知道「要继续做什么」的
 * 是这里生成的清单正文——它作为用户消息派发出去，因此不依赖运行时快照里
 * 是否恰好带了待办，清单一定准确。
 */

/** 清单过长时正文里保留的条目上限，避免一次性塞入过长的请求 */
const MAX_ITEMS = 20

/**
 * 构造「继续执行」派发给模型的消息正文
 *
 * @param remaining 未完成任务清单（按建议的执行顺序）
 */
export function buildContinuationPrompt(remaining: string[]): string {
  const items = (remaining || [])
    .map(item => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS)

  if (items.length === 0) {
    return '继续执行未完成的任务'
  }

  const lines = items.map((item, index) => `${index + 1}. ${item}`)

  return [
    '继续完成以下未完成任务：',
    ...lines,
    '',
    '请从第一项开始依次完成，不要重复已经做过的工作。',
  ].join('\n')
}

/** 用户选择「暂时不用」时派发的简短回复 */
export const CONTINUATION_DECLINE_MESSAGE = '暂时不用继续了'
