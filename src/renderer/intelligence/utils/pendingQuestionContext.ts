/**
 * 待确认提问的上下文衔接
 *
 * 场景：AI 执行完成后在回复末尾提问（「要不要我继续实现注册功能？」），
 * 用户只回一句「要」。这类**简短确认**本身不携带任何信息，一旦上一条助手
 * 提问因为上下文压缩 / 交接 / 上下文裁剪 / 模型路由等原因没有进入本次请求，
 * AI 就会「不知道要做什么」，只能反过来问用户「你指的是什么」。
 *
 * 方案：在 Agent.send 组装新消息前，若用户消息属于**肯定型简短确认**，且上一条
 * 助手消息确实以提问 / 提议结尾，则自动在用户消息前附加一段「上下文衔接说明」，
 * 把上一条提问原文明确告知模型。这样即使历史被裁剪，衔接语义也不会丢。
 *
 * 与 resumeContext（断点续接）互补：
 * - resumeContext：上次执行被**异常中断**（有未完成工具调用）时的续接说明
 * - 本模块：上次执行**正常结束但留下提问**、「继续」类确认的衔接说明
 */

import { getMessageText, type ChatThread, type AssistantMessage, type UserMessage } from '@intelligence/providerTypes'

/** 有效字符上限：超过该长度的消息视为用户自己的完整表述，不再当作「简短确认」 */
const SHORT_REPLY_MAX_CHARS = 12

/** 否定 / 收尾语：命中则判定「不是在肯定提问」，不附加衔接说明 */
const NEGATIVE_MARKERS = [
  '不用', '不需要', '不要', '别', '算了', '取消', '停止', '终止', '暂时不', '不继续',
  '谢谢', '不了', '好的谢谢', '辛苦了',
  'no', 'nope', 'not now', "don't", 'dont', 'stop', 'cancel', 'thanks', 'thank you', 'later',
]

/** 肯定 / 继续语：命中才认为用户是在确认上一条提问 */
const AFFIRMATIVE_MARKERS = [
  '要', '需要', '可以的', '可以', '好的', '好', '行', '是的', '对', '嗯', '没问题', '同意',
  '确认', '继续', '开始', '做吧', '来吧', '干吧', '执行', '帮我', '辛苦你', '请继续', '就这样',
  'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'go ahead', 'go on', 'do it', 'please do',
  'proceed', 'continue', 'start', 'confirm', 'agreed', 'fine', 'absolutely', 'of course',
]

/** 提问 / 提议特征：上一条助手消息命中才认为存在「待确认提问」 */
const QUESTION_MARKERS = [
  '要不要', '是否要', '是否需要', '需要我', '要我', '是否继续', '继续吗', '可以吗', '好吗',
  '行吗', '对吧', '如何', '还是', '要不要我', '是否需要我', '请确认', '请你确认',
  'shall i', 'should i', 'do you want', 'would you like', 'want me to', 'may i', 'can i',
  'continue?', 'proceed?',
]

function normalize(text: string): string {
  return text.trim().replace(/[\s，。！？!?,.:：;；、~～"'“”‘’()（）]+/g, '')
}

/** 是否属于「肯定型简短确认」（如 要 / 好的 / 继续 / yes / ok） */
export function isShortAffirmativeReply(text: string): boolean {
  const raw = normalize(text)
  if (!raw) return false
  if (raw.length > SHORT_REPLY_MAX_CHARS) return false

  const lower = raw.toLowerCase()
  if (NEGATIVE_MARKERS.some(marker => lower.includes(marker.toLowerCase()))) return false
  return AFFIRMATIVE_MARKERS.some(marker => lower.includes(marker.toLowerCase()))
}

/** 提取助手消息的可见文本（content 为空时回退到文本 part / 交互式提问） */
function extractAssistantText(message: AssistantMessage): string {
  const fromContent = getMessageText(message.content).trim()
  if (fromContent) return fromContent

  const fromParts = (message.parts || [])
    .filter((part): part is { type: 'text'; content: string } =>
      !!part && (part as { type?: string }).type === 'text' && typeof (part as { content?: unknown }).content === 'string',
    )
    .map(part => part.content)
    .join('')
    .trim()
  if (fromParts) return fromParts

  // ask_user 交互式提问：提问正文在 interactive.question 中
  const interactive = (message as AssistantMessage & { interactive?: { question?: string } }).interactive
  if (interactive?.question) return `请问：${interactive.question}`

  return ''
}

/** 判断助手文本是否以提问 / 提议结尾（或包含明确的征询句式） */
function looksLikePendingQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/[?？]\s*$/.test(trimmed)) return true

  const tail = trimmed.slice(-160).toLowerCase()
  return QUESTION_MARKERS.some(marker => tail.includes(marker))
}

interface PendingQuestionInfo {
  question: string
  lastUserRequest: string
}

/** 扫描线程，找出最后一条助手消息中的待确认提问 */
function findPendingQuestion(thread: ChatThread | undefined): PendingQuestionInfo | null {
  if (!thread?.messages?.length) return null

  let lastAssistantText = ''
  let lastUserRequest = ''

  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i]
    if (message.role === 'assistant' && !lastAssistantText) {
      lastAssistantText = extractAssistantText(message as AssistantMessage)
    } else if (message.role === 'user' && !lastUserRequest) {
      lastUserRequest = getMessageText((message as UserMessage).content).trim()
    }
    if (lastAssistantText && lastUserRequest) break
  }

  if (!lastAssistantText || !looksLikePendingQuestion(lastAssistantText)) return null

  return {
    question: lastAssistantText.slice(-600),
    lastUserRequest: lastUserRequest.slice(0, 300),
  }
}

/**
 * 构造「待确认提问」衔接说明；无需附加时返回 null
 *
 * @param thread       当前会话线程（发送新消息之前的快照）
 * @param incomingText 用户本次发送的消息文本
 * @param language     界面语言（决定说明文案语种）
 */
export function buildPendingQuestionNotice(
  thread: ChatThread | undefined,
  incomingText: string,
  language: 'zh' | 'en' = 'zh',
): string | null {
  if (!isShortAffirmativeReply(incomingText)) return null

  const pending = findPendingQuestion(thread)
  if (!pending) return null

  if (language === 'en') {
    return [
      '## Context Bridge (auto-attached)',
      'The user replied with a short confirmation to your previous question. Your previous question was:',
      '"""',
      pending.question,
      '"""',
      pending.lastUserRequest ? `Context: the user's earlier request was "${pending.lastUserRequest}".` : '',
      'Treat the short reply as confirmation of that question and continue accordingly (start the proposed work directly, without asking again what the user means). If the reply clearly means the opposite (declining), then stop and confirm instead.',
    ]
      .filter(Boolean)
      .join('\n')
  }

  return [
    '## 上下文衔接（自动附加）',
    '用户本次回复是对你上一条提问的简短确认。你上一条提问原文如下：',
    '"""',
    pending.question,
    '"""',
    pending.lastUserRequest ? `背景：用户之前的请求是「${pending.lastUserRequest}」。` : '',
    '请把这条简短回复理解为对该提问的肯定确认，并直接按提问中的提议继续执行（不要再次询问用户「你指的是什么」）。若该回复明显是否定/收尾之意，则停止并简短确认即可。',
  ]
    .filter(Boolean)
    .join('\n')
}

/* ------------------------------------------------------------------ */
/* 选项交互的回答衔接                                                 */
/* ------------------------------------------------------------------ */

/** 助手消息上的交互式选项内容 */
interface InteractiveSelection {
  question: string
  options: Array<{ id: string; label: string }>
}

/** 提取助手消息上的交互式选项；不是选项类交互时返回 null */
function extractInteractiveSelection(message: AssistantMessage): InteractiveSelection | null {
  const interactive = (message as AssistantMessage & {
    interactive?: { question?: string; options?: Array<{ id?: string; label?: string }> }
  }).interactive

  if (!interactive?.question) return null

  const rawOptions = Array.isArray(interactive.options) ? interactive.options : []
  const options = rawOptions
    .filter((opt): opt is { id?: string; label: string } => typeof opt?.label === 'string')
    .map((opt, index) => ({ id: opt.id || `option-${index}`, label: opt.label }))

  if (options.length === 0) return null

  return { question: interactive.question, options }
}

/**
 * 取线程中最后一条助手消息上的选项交互
 *
 * 只认最后一条助手消息：更早的交互早已被回答过，若据此附加说明，
 * 会把一条无关的新消息错误地解释成对旧选项的回答。
 */
function findLastInteractiveSelection(thread: ChatThread | undefined): InteractiveSelection | null {
  if (!thread?.messages?.length) return null

  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i]
    if (message.role !== 'assistant') continue
    return extractInteractiveSelection(message as AssistantMessage)
  }
  return null
}

/** 把用户文本与选项文案做匹配（单选为单个文案；多选由界面用顿号/逗号拼接） */
function matchSelectedOptions(
  text: string,
  options: InteractiveSelection['options'],
): InteractiveSelection['options'] {
  const whole = normalize(text)
  if (!whole) return []

  const segments = text
    .split(/[,，、;；]/)
    .map((segment) => normalize(segment))
    .filter(Boolean)

  return options.filter((option) => {
    const label = normalize(option.label)
    if (!label) return false
    return whole === label || segments.includes(label)
  })
}

/**
 * 构造「用户点了哪个选项」的衔接说明；无需附加时返回 null
 *
 * 与 buildPendingQuestionNotice 的分工：那边处理「用户手打一句『要』」，
 * 这里处理「用户点了选项卡片」。选项文案通常只是一个短名词（如「功能开发」），
 * 脱离提问后不具指向性，因此把提问原文与全部选项一并带给模型。
 *
 * @param thread       当前会话线程（发送新消息之前的快照）
 * @param incomingText 用户本次发送的消息文本（即选项文案）
 * @param language     界面语言（决定说明文案语种）
 */
export function buildInteractiveSelectionNotice(
  thread: ChatThread | undefined,
  incomingText: string,
  language: 'zh' | 'en' = 'zh',
): string | null {
  const selection = findLastInteractiveSelection(thread)
  if (!selection) return null

  const picked = matchSelectedOptions(incomingText, selection.options)
  const optionList = selection.options.map((option) => option.label).join(' / ')

  if (language === 'en') {
    const answer = picked.length > 0
      ? `The user selected: ${picked.map((option) => option.label).join(', ')}.`
      : `The user replied with "${incomingText}" — not one of the listed options, so treat it as a free-form answer.`
    return [
      '## Context Bridge (auto-attached)',
      'Your previous turn asked the user to pick from options. Your question was:',
      '"""',
      selection.question,
      '"""',
      `Options offered: ${optionList}`,
      answer,
      'Treat the reply as the answer to that question and continue from there — do not ask the user again what they mean.',
    ].join('\n')
  }

  const answer = picked.length > 0
    ? `用户选择了：${picked.map((option) => option.label).join('、')}。`
    : `用户回复的是：「${incomingText}」，不属于上面给出的选项，按自由作答处理。`
  return [
    '## 上下文衔接（自动附加）',
    '你上一条回复让用户在选项中做选择。你的提问原文如下：',
    '"""',
    selection.question,
    '"""',
    `当时给出的选项：${optionList}`,
    answer,
    '请把它理解为对该提问的回答，并据此继续执行（不要再次询问用户「你指的是什么」）。',
  ].join('\n')
}
