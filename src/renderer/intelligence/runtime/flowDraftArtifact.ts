/**
 * 快捷流草稿的产物封装
 *
 * 桌面端能看见「这次任务到底调了哪些工具、哪些参数随任务变化」，移动端只能看到
 * 日志文本。所以快捷流的步骤由桌面端按执行轨迹生成，移动端只负责展示与确认。
 *
 * 字段与移动端 services/flowDraft.ts 的 FlowDraft 对齐：两端读的是同一套结构，
 * 移动端无需再做一次字段映射，也不会因为各写一套而漂移。
 *
 * @module runtime/flowDraftArtifact
 */
import type { ProceduralTemplate } from './proceduralSkillLearner'
import type { SkillDraft } from './skillDraftProposer'

/** 快捷流草稿产物的固定标题：两端必须一致 */
export const FLOW_DRAFT_ARTIFACT_TITLE = '__flow_draft__'

/** 单个步骤 */
export interface FlowDraftStepPayload {
  text: string
  /** 需要用户确认后替换的参数占位名，如「文件路径」 */
  placeholder?: string
}

/** 快捷流草稿（与移动端 FlowDraft 同构，去掉本地 id） */
export interface FlowDraftPayload {
  title: string
  description: string
  steps: FlowDraftStepPayload[]
  createdAt: number
}

/** 占位符名 → 给用户看的中文参数名 */
const PLACEHOLDER_LABELS: Record<string, string> = {
  file_path: '文件路径',
  path: '文件路径',
  directory: '目录',
  dir: '目录',
  folder: '目录',
  url: '网页地址',
  link: '网页地址',
  search_query: '搜索内容',
  pattern: '匹配内容',
  content: '内容',
  text: '内容',
  name: '名称',
  message: '消息',
  description: '描述',
}

function labelForPlaceholder(raw: string): string {
  return PLACEHOLDER_LABELS[raw] || raw
}

/** 把一个工具步骤渲染成一句可读的步骤说明 */
function renderTemplateStep(step: ProceduralTemplate['toolSequence'][number], index: number): FlowDraftStepPayload {
  const args = Object.entries(step.params).map(([key, slot]) => {
    if (slot.type === 'dynamic') {
      return `${key}=<${slot.placeholder ?? key}>`
    }
    return `${key}=${slot.value ?? ''}`
  })

  const argPart = args.length > 0 ? `（${args.join('，')}）` : ''

  // 占位符只取第一个动态参数：用户确认时一次只改一处最省心
  const dynamic = Object.values(step.params).find(slot => slot.type === 'dynamic')
  const payload: FlowDraftStepPayload = {
    text: `${index + 1}. ${step.toolName}${argPart}`,
  }
  if (dynamic?.placeholder) payload.placeholder = labelForPlaceholder(dynamic.placeholder)
  return payload
}

/**
 * 从 SKILL.md 文本里读回步骤
 *
 * 只在没有模板结构时兜底：SKILL.md 是人读的文档，解析它天然脆弱，
 * 所以它永远排在结构化轨迹之后。
 */
export function stepsFromSkillBody(body: string): FlowDraftStepPayload[] {
  const lines = body.split('\n')
  const steps: FlowDraftStepPayload[] = []
  const stepLine = /^\d+\.\s+`([^`]+)`(.*)$/

  for (const line of lines) {
    const match = line.trim().match(stepLine)
    if (!match) continue
    const placeholderMatch = (match[2] || '').match(/<([^>]+)>/)
    const payload: FlowDraftStepPayload = { text: line.trim() }
    if (placeholderMatch?.[1]) payload.placeholder = labelForPlaceholder(placeholderMatch[1])
    steps.push(payload)
  }

  return steps
}

/**
 * 生成快捷流草稿
 *
 * 步骤优先取自模板的结构化工具序列，其次退回 SKILL.md 文本；
 * 两者都没有时给一条覆盖整件事的说明，而不是交一个空草稿。
 */
export function buildFlowDraftPayload(input: {
  title: string
  description: string
  template?: ProceduralTemplate | null
  skillDraft?: SkillDraft | null
}): FlowDraftPayload {
  let steps: FlowDraftStepPayload[] = []

  if (input.template && input.template.toolSequence.length > 0) {
    steps = input.template.toolSequence.map((step, index) => renderTemplateStep(step, index))
  } else if (input.skillDraft?.body) {
    steps = stepsFromSkillBody(input.skillDraft.body)
  }

  if (steps.length === 0) {
    steps = [{ text: input.description || input.title }]
  }

  return {
    title: input.title,
    description: input.description,
    steps,
    createdAt: Date.now(),
  }
}

/** 把草稿封成产物；序列化失败返回 null，不阻断任务完成上报 */
export function toFlowDraftArtifact(payload: FlowDraftPayload): {
  type: 'text'
  title: string
  content: string
} | null {
  try {
    return {
      type: 'text',
      title: FLOW_DRAFT_ARTIFACT_TITLE,
      content: JSON.stringify(payload),
    }
  } catch {
    return null
  }
}
