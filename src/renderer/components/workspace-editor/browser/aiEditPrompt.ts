/**
 * AI 修改指令拼装
 *
 * 把「用户点中的元素」与「用户想怎么改」合成一条发给 AI 的消息。
 *
 * 改源码还是改运行时，不在这里判断：客户端只知道页面地址，并不知道这个页面
 * 是不是当前工作区构建出来的。把两条路径和判断依据写进提示词，交给模型
 * 自己看工作区决定——它能搜索源码，比前端猜得准。
 */
import type { PickedElement } from '../../../../main/modules/preview/previewDomProbe'

/** 文本类内容在提示词里的截断长度 */
const PROMPT_TEXT_LIMIT = 300

/**
 * 「把这条指令发给 AI」的 window 事件名
 *
 * 内置浏览器嵌在编辑器里，拿不到聊天面板的发送函数；用事件交给
 * PluginHostBridge 统一转发，与插件发消息走同一条链路。
 */
export const BROWSER_AI_EDIT_EVENT = 'aweeclaw:browser-ai-edit'

/**
 * @param picked     用户选中的元素快照
 * @param instruction 用户输入的修改要求
 * @param pageUrl    当前页面地址，用于让模型判断页面来源
 */
export function buildAIEditPrompt(
  picked: PickedElement,
  instruction: string,
  pageUrl?: string,
): string {
  const classes = picked.classes.length > 0 ? picked.classes.join(' ') : '(none)'
  const text = (picked.selectedText || picked.text || '').slice(0, PROMPT_TEXT_LIMIT)

  const lines: string[] = [
    '【在页面上修改我选中的元素】',
    `页面地址：${pageUrl || '(unknown)'}`,
    `元素选择器：${picked.selector}`,
    `标签：<${picked.tag}>　尺寸：${picked.rect.w}×${picked.rect.h}`,
    `class：${classes}`,
  ]

  if (picked.id) lines.push(`id：${picked.id}`)
  if (picked.sameSiblings > 1) {
    lines.push(`同父下结构相同的兄弟元素：${picked.sameSiblings} 个`)
  }
  if (picked.embeddedFrame) {
    lines.push('注意：这是内嵌 frame 容器，其内部 DOM 不可达，只能改容器本身。')
  }
  if (picked.selectedText) {
    lines.push(`用户选中的文字：${picked.selectedText.slice(0, PROMPT_TEXT_LIMIT)}`)
  } else if (text) {
    lines.push(`元素当前文案：${text}`)
  }

  lines.push('')
  lines.push(`我的修改要求：${instruction}`)
  lines.push('')
  lines.push('处理要求：')
  lines.push(
    `1. 先调用 mcp_builtin-browser__browser_element_context 读取该元素完整上下文（selector 用上面那个），需要判断视觉问题时带上 include_screenshot。`,
  )
  lines.push(
    '2. 如果这个页面来自当前工作区（本地 dev server 或本地静态预览），优先在工作区里定位源文件并直接改源码：用元素文案、class 名搜索定位，改完让 HMR 刷新。这才是能持久生效的修改。',
  )
  lines.push(
    '3. 定位不到源码、或页面不是本地项目时，再用 mcp_builtin-browser__browser_edit_element 做运行时修改；需要连带改同类兄弟元素（卡片、列表项）时传 scope="similar"。',
  )
  lines.push('4. 不要用 browser_evaluate 手写 JS 改 DOM：运行时改动不可回滚，也无法验证。')
  lines.push(
    '5. 完成后用一两句话说明改了什么，并说明这次改的是源码文件还是运行时覆盖；只改运行时的时候，提醒我刷新页面会失效。',
  )

  return lines.join('\n')
}

/**
 * 文档（ONLYOFFICE）AI 修改提示词
 *
 * 文档编辑区是 canvas，没有元素可选，改的是选区里的文字。要求模型只回替换
 * 文本：用户拿到结果直接粘进浮层替换框，多一层解释就得手动摘出来。
 */
export function buildDocAiEditPrompt(params: {
  fileName: string
  sourceText: string
  instruction: string
}): string {
  const source = params.sourceText.slice(0, DOC_PROMPT_TEXT_LIMIT)
  const truncated = params.sourceText.length > DOC_PROMPT_TEXT_LIMIT

  const lines: string[] = [
    '【修改我在文档里选中的这段内容】',
    `文档：${params.fileName || '(unknown)'}`,
    '',
    '选中的原文：',
    '"""',
    source,
    '"""',
  ]

  if (truncated) {
    lines.push('（原文较长，以上仅为开头部分，改写时按这段内容本身的风格续写即可）')
  }

  lines.push('')
  lines.push(`我的修改要求：${params.instruction}`)
  lines.push('')
  lines.push('处理要求：')
  lines.push('1. 只输出替换后的文本本身，不要解释、不要前后缀、不要包 Markdown 代码块。')
  lines.push('2. 保留原文的语气、编号层级、标点习惯与专有名词。')
  lines.push('3. 原文里的数据、人名、机构名不要改写或编造；要求里没说改的地方保持原样。')
  lines.push('4. 我会把你输出的内容直接粘贴替换选中的那段文字。')

  return lines.join('\n')
}

/** 文档提示词里原文的截断长度：再长也只是稀释信号 */
const DOC_PROMPT_TEXT_LIMIT = 4000
