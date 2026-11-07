/**
 * 回答交出前的事实核对
 *
 * 要解决的问题只有一句话：AI 说「已生成 3 个报告」「改了 5 处」，而实际不是。
 * 这是 Agent 产品最伤信任的失败模式 —— 比报错严重，因为用户发现一次之后
 * 就再也不信「完成了」。
 *
 * 做法是纯字面核对，不做语义判断，也不引入第二次模型调用：
 *
 * - 只核「有辨识度」的事实：文件路径、日期、URL、带小数的数字、百分比。
 *   单个整数不核 —— 「3 个文件」这类表述与工具结果很难字面对齐，硬核会大量误报。
 * - 事实项必须在本次任务读到的材料里出现过（子串匹配）。
 * - 核不上不是阻断，只是标记「未确认」，照常交出。
 *
 * 不拦死是刻意的：拦死会让用户觉得「AI 又在啰嗦」，最终所有人都会去关掉它。
 *
 * @module intelligence/verify/answerGrounding
 */

/** 核对结果 */
export interface GroundingResult {
  /** 无法在材料中找到依据的事实项 */
  gaps: string[]
  /** 是否真的做了核对（没调过工具、或回答里没有可核事实时为 false） */
  checked: boolean
}

/** 带小数的数字或百分比：单个整数不核，误报太高；百分比分支优先，保留单位 */
const DECIMAL_NUMBER_RE = /\b\d+(?:\.\d+)?%|\b\d+\.\d+\b/g
/** 文件路径：至少带扩展名，避免把普通英文单词当路径 */
const PATH_RE = /(?:[\w.-]+\/)*[\w.-]+\.(?:[A-Za-z]{1,5})\b/g
/** ISO 日期 */
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g
/** URL */
const URL_RE = /https?:\/\/[^\s)\]"'，。；]+/g

/** 路径类事实必须带这些扩展名才算「有辨识度」，否则容易命中正常词汇 */
const MEANINGFUL_EXT =
  /\.(?:ts|tsx|js|jsx|vue|json|md|py|go|java|rs|c|cpp|h|css|scss|html|yml|yaml|toml|sql|sh|txt|log|csv|xlsx?|docx?|pdf|pptx?)$/i

/** 抽取出回答中的可核事实 */
export function extractFacts(answer: string): string[] {
  if (!answer) return []
  const facts = new Set<string>()

  for (const m of answer.match(URL_RE) || []) facts.add(m.trim())
  for (const m of answer.match(DATE_RE) || []) facts.add(m.trim())
  for (const m of answer.match(DECIMAL_NUMBER_RE) || []) facts.add(m.trim())
  for (const m of answer.match(PATH_RE) || []) {
    const trimmed = m.trim()
    // 只有带代码 / 文档类扩展名的才当作路径事实
    if (MEANINGFUL_EXT.test(trimmed)) facts.add(trimmed)
  }

  return Array.from(facts)
}

/** 材料里是否出现过该事实（先原样，再规范化分隔符） */
function hasEvidence(fact: string, corpus: string): boolean {
  if (corpus.includes(fact)) return true
  // Windows 反斜杠与正斜杠混用、URL 尾斜杠差异都会让原样子串匹配失败
  const normalizedFact = fact.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedCorpus = corpus.replace(/\\/g, '/')
  return normalizedCorpus.includes(normalizedFact)
}

/**
 * 核对一次回答
 *
 * @param answer      最终回答正文
 * @param toolTexts   本任务内工具结果 / 读取材料的文本集合
 * @param hadToolCalls 本任务是否调用过任何工具（纯问答不核）
 */
export function checkAnswerGrounding(input: {
  answer: string
  toolTexts: string[]
  hadToolCalls: boolean
}): GroundingResult {
  const { answer, toolTexts, hadToolCalls } = input

  // 纯问答 / 常识 / 聊天：没有材料可核，不核
  if (!hadToolCalls) return { gaps: [], checked: false }

  const facts = extractFacts(answer)
  // 没有可核事实：视为「未核对」，而不是「核实通过」
  if (facts.length === 0) return { gaps: [], checked: false }

  const corpus = toolTexts.filter(Boolean).join('\n')
  if (!corpus) return { gaps: facts, checked: true }

  const gaps = facts.filter((fact) => !hasEvidence(fact, corpus))
  return { gaps, checked: true }
}

/**
 * 把核对结果拼成交付内容上的一行提示
 *
 * 只标记不拦截：正常交出，用户知道哪几项没找到依据即可。
 */
export function buildGroundingNotice(result: GroundingResult): string {
  if (!result.checked || result.gaps.length === 0) return ''
  const head = result.gaps.slice(0, 5).join('、')
  const more = result.gaps.length > 5 ? ` 等 ${result.gaps.length} 项` : ''
  return `\n\n> 未确认：以下内容未在本次读取的材料中找到依据 —— ${head}${more}`
}
