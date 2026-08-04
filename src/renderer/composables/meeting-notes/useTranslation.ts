/**
 * 会议纪要 LLM 翻译 hook
 *
 * 职责：
 * - 调用 LLM 将任意语言的文本翻译为中文
 * - 自动检测源语言（让 LLM 判断，无需额外的语言检测服务）
 * - 中文源文本自动跳过（避免无意义的 LLM 调用）
 *
 * 调用方式：
 *   const translate = useTranslation()
 *   const result = await translate('Hello everyone', llmConfig)
 *
 * 实现要点：
 * - 使用 api.llm.send 流式接口，但仅取最终文本（非流式展示）
 * - 系统提示要求 LLM 输出 JSON：{ translated, skipped, detectedLang }
 * - 失败时返回原文（保证用户体验）
 */

import { useCallback, useRef } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import type { LLMConfig } from '@shared/protocols/modelProtocol'
import { callLLM } from './callLLM'

export interface TranslateResult {
  /** 是否成功 */
  success: boolean
  /** 翻译后文本（中文） */
  translated: string
  /** 检测到的源语言 */
  detectedLang: string
  /** 是否已是中文跳过翻译 */
  skipped: boolean
  /** 错误信息 */
  error?: string
}

// ============================================
// 常量
// ============================================

const TRANSLATION_SYSTEM_PROMPT = `你是一个专业的会议翻译助手。请将用户输入的文本翻译为简体中文。

要求：
1. 自动检测源语言，如果已是中文则原样返回
2. 保留专业术语、人名、产品名的原文（在括号中补充中文释义）
3. 保持原文的语气和语意
4. 不要添加额外解释或备注

输出格式（严格 JSON）：
{"translated": "翻译后的中文文本", "detectedLang": "源语言代码如 en/ja/zh", "skipped": false}

如果原文已经是中文，输出：{"translated": "原文", "detectedLang": "zh", "skipped": true}`

const DEFAULT_TIMEOUT_MS = 20000

/** 中文检测：若文本中中文字符占比 > 60% 视为已是中文 */
function isMostlyChinese(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  let chineseCount = 0
  let totalCount = 0
  for (const ch of trimmed) {
    if (/[\u4e00-\u9fa5]/.test(ch)) chineseCount++
    if (/\S/.test(ch)) totalCount++
  }
  return totalCount > 0 && chineseCount / totalCount > 0.6
}

export function useTranslation() {
  // 并发限流：避免段太多时打爆 LLM
  const inflightCountRef = useRef(0)
  const maxConcurrent = 3

  const translate = useCallback(
    async (text: string, llmConfig: LLMConfig | null): Promise<TranslateResult> => {
      const trimmed = text.trim()
      if (!trimmed) {
        return { success: true, translated: '', detectedLang: 'auto', skipped: true }
      }

      // 中文跳过
      if (isMostlyChinese(trimmed)) {
        return { success: true, translated: trimmed, detectedLang: 'zh', skipped: true }
      }

      if (!llmConfig) {
        return {
          success: false,
          translated: trimmed,
          detectedLang: 'auto',
          skipped: false,
          error: 'LLM 配置缺失，无法翻译',
        }
      }

      // 并发限流
      while (inflightCountRef.current >= maxConcurrent) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      inflightCountRef.current++

      try {
        const messages = [
          { role: 'user' as const, content: trimmed },
        ]

        const result = await callLLM(llmConfig, messages, {
          systemPrompt: TRANSLATION_SYSTEM_PROMPT,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        })

        const content = result.content || ''
        if (!content) {
          return {
            success: false,
            translated: trimmed,
            detectedLang: 'auto',
            skipped: false,
            error: 'LLM 返回为空',
          }
        }

        // 尝试解析 JSON（LLM 可能输出多余内容）
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]) as {
              translated?: string
              detectedLang?: string
              skipped?: boolean
            }
            return {
              success: true,
              translated: parsed.translated || trimmed,
              detectedLang: parsed.detectedLang || 'auto',
              skipped: !!parsed.skipped,
            }
          } catch {
            // JSON 解析失败，降级为原文
          }
        }

        // 降级：直接使用 LLM 返回的文本作为翻译
        return {
          success: true,
          translated: content.trim() || trimmed,
          detectedLang: 'auto',
          skipped: false,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.system.error('[Translation] LLM failed:', err)
        return {
          success: false,
          translated: trimmed,
          detectedLang: 'auto',
          skipped: false,
          error: msg,
        }
      } finally {
        inflightCountRef.current--
      }
    },
    [],
  )

  return { translate }
}
