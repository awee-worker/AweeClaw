/**
 * taskQualityAi — AI 优化任务描述
 *
 * 调用 LLM 分析用户输入的任务标题和描述，返回结构化的质量元数据：
 * - 预期产出（AI 推断的交付物）
 * - 验收标准（AI 生成的检查清单）
 * - 约束条件（AI 推断的技术栈/规范）
 * - 优化建议（描述中缺失的信息）
 * - 质量评分（1-10，描述清晰度）
 *
 * 设计原则：
 * - 纯前端调用，复用 callLLM（非流式封装）
 * - 返回 JSON 格式，解析失败时返回 null（不阻断流程）
 * - 不修改用户原始描述，只补充建议
 */
import { callLLM } from '@renderer/composables/meeting-notes/callLLM'
import { logger } from '@shared/toolkit/LogEngine'
import type { LLMConfig } from '@shared/protocols/modelProtocol'
import type { TaskQualityMeta } from './taskQuality'

/** AI 优化结果的 JSON 结构 */
interface AiOptimizeResult {
  expectedOutput?: string
  acceptanceCriteria?: string[]
  constraints?: string
  aiSuggestions?: string
  qualityScore?: number
}

/**
 * 构建系统提示词
 *
 * 引导 AI 以工程顾问视角分析任务，输出结构化 JSON。
 */
function buildSystemPrompt(isZh: boolean): string {
  return isZh
    ? `你是一名资深项目管理顾问。分析用户提供的任务标题和描述，输出结构化的质量元数据，帮助用户提升任务描述质量。

要求：
1. 推断「预期产出」：任务应该交付什么（代码文件/文档/分析报告等）
2. 生成 2-5 条「验收标准」：可逐条检查的完成标准
3. 推断「约束条件」：技术栈/编码规范/禁止事项（如描述中未明确，基于常见实践推断）
4. 给出「优化建议」：指出描述中缺失或模糊的信息（如未提及技术栈、未说明输入输出等）
5. 评估「质量评分」（1-10）：描述清晰度和完整度，10 分为非常清晰完整

输出格式为 JSON（只输出 JSON，不要其他文字）：
\`\`\`json
{
  "expectedOutput": "预期产出描述",
  "acceptanceCriteria": ["标准1", "标准2"],
  "constraints": "约束条件",
  "aiSuggestions": "优化建议",
  "qualityScore": 7
}
\`\`\``
    : `You are a senior project management consultant. Analyze the user's task title and description, then output structured quality metadata to help improve task clarity.

Requirements:
1. Infer "expectedOutput": what should be delivered (code files/docs/reports etc.)
2. Generate 2-5 "acceptanceCriteria": checkable completion standards
3. Infer "constraints": tech stack/coding standards/restrictions (infer from common practices if not stated)
4. Provide "aiSuggestions": point out missing or ambiguous information
5. Rate "qualityScore" (1-10): clarity and completeness, 10 being very clear and complete

Output JSON only (no other text):
\`\`\`json
{
  "expectedOutput": "expected output description",
  "acceptanceCriteria": ["criterion 1", "criterion 2"],
  "constraints": "constraints",
  "aiSuggestions": "suggestions",
  "qualityScore": 7
}
\`\`\``
}

/**
 * 从 AI 回复文本中提取 JSON
 *
 * AI 可能把 JSON 包在 ```json ``` 代码块中，也可能直接输出。
 * 此函数做防御性提取，提取失败返回 null。
 */
function extractJson(text: string): AiOptimizeResult | null {
  if (!text) return null

  // 尝试从 ```json ``` 代码块中提取
  const codeBlockMatch = /```json\s*([\s\S]*?)```/i.exec(text)
  const jsonText = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim()

  try {
    const parsed = JSON.parse(jsonText) as AiOptimizeResult
    // 基本校验
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed
  } catch {
    // JSON 解析失败，尝试找第一个 { 到最后一个 } 之间的内容
    const startIdx = jsonText.indexOf('{')
    const endIdx = jsonText.lastIndexOf('}')
    if (startIdx !== -1 && endIdx > startIdx) {
      try {
        const parsed = JSON.parse(jsonText.slice(startIdx, endIdx + 1)) as AiOptimizeResult
        return parsed
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * AI 优化任务描述
 *
 * @param llmConfig LLM 配置（来自 store.llmConfig）
 * @param taskInfo 任务标题和描述
 * @param isZh 是否中文
 * @returns 质量元数据（解析失败返回 null）
 */
export async function optimizeTaskDescription(
  llmConfig: LLMConfig | null,
  taskInfo: { title: string; description: string },
  isZh: boolean,
): Promise<TaskQualityMeta | null> {
  if (!llmConfig) {
    return null
  }

  const systemPrompt = buildSystemPrompt(isZh)
  const userPrompt = isZh
    ? `任务标题：${taskInfo.title || '（未填写）'}\n\n任务描述：${taskInfo.description || '（未填写）'}\n\n请分析并输出结构化质量元数据。`
    : `Task Title: ${taskInfo.title || '(not provided)'}\n\nTask Description: ${taskInfo.description || '(not provided)'}\n\nPlease analyze and output structured quality metadata.`

  try {
    const result = await callLLM(
      llmConfig,
      [{ role: 'user', content: userPrompt }],
      { systemPrompt, timeoutMs: 60000 },
    )

    const parsed = extractJson(result.content)
    if (!parsed) {
      logger.system.warn('[optimizeTaskDescription] Failed to parse AI response')
      return null
    }

    // 转换为 TaskQualityMeta，做类型清洗
    const meta: TaskQualityMeta = {}
    if (typeof parsed.expectedOutput === 'string' && parsed.expectedOutput.trim()) {
      meta.expectedOutput = parsed.expectedOutput.trim()
    }
    if (Array.isArray(parsed.acceptanceCriteria)) {
      meta.acceptanceCriteria = parsed.acceptanceCriteria
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map(c => c.trim())
    }
    if (typeof parsed.constraints === 'string' && parsed.constraints.trim()) {
      meta.constraints = parsed.constraints.trim()
    }
    if (typeof parsed.aiSuggestions === 'string' && parsed.aiSuggestions.trim()) {
      meta.aiSuggestions = parsed.aiSuggestions.trim()
    }
    if (typeof parsed.qualityScore === 'number' && parsed.qualityScore >= 1 && parsed.qualityScore <= 10) {
      meta.qualityScore = Math.round(parsed.qualityScore)
    }

    return meta
  } catch (e) {
    logger.system.error('[optimizeTaskDescription] AI call failed:', e)
    return null
  }
}
