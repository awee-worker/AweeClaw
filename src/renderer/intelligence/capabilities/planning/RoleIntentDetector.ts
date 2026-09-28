/**
 * 轻量意图识别器
 *
 * 关键词表映射到 RoleIntent，纯规则实现，不引入模型调用。
 * 与 TaskComplexityDetector 并列，供 sceneRoleMatcher 的规则层
 * 匹配（intents 命中 +0.3）使用。
 *
 * @see aweeclaw-client/docs/role-library/01-role-library-design.md 5.2 节
 */

import type { RoleIntent } from '../role/RoleDescriptor'

/** 意图 → 触发词表（子串匹配，命中即计入） */
const INTENT_PATTERNS: Record<RoleIntent, RegExp[]> = {
  drafting: [/起草/, /润色/, /写一?[份个封篇][^\s]{0,6}(文档|方案|邮件|周报|纪要)/, /拟一?份/],
  summarizing: [/总结/, /提炼/, /归纳/, /纪要/, /小结/],
  analyzing: [/分析/, /解读/, /对比数据/, /同比/, /环比/, /统计/, /评估数据/],
  reviewing: [/审查/, /评审/, /检查/, /找问题/, /查错/, /review/i],
  planning: [/规划/, /排期/, /拆解/, /计划/, /安排/, /里程碑/],
  explaining: [/讲解/, /解释/, /什么是/, /为什么/, /怎么理解/, /通俗/],
  practicing: [/出题/, /考我/, /自测/, /练习题/, /背诵/, /复习题/],
  reminding: [/提醒/, /跟进/, /别忘了/, /待办/],
  companioning: [/心烦/, /压力/, /累死/, /emo/, /倾诉/, /心情不好/, /难受/],
  deciding: [/选型/, /怎么选/, /哪个好/, /值不值/, /决策/, /对比.*(选|买|用)/],
  translating: [/翻译/, /译成/, /译为/, /中译英/, /英译中/, /translate/i],
  coding: [/写代码/, /代码/, /函数实现/, /接口实现/, /调试/, /重构/, /报错/, /bug/i, /debug/i],
  researching: [/查一下/, /查查/, /查资料/, /检索/, /调研/, /搜一下/, /搜索资料/, /找资料/, /research/i],
  brainstorming: [/头脑风暴/, /创意/, /点子/, /灵感/, /想几个/, /brainstorm/i],
  communicating: [/话术/, /怎么回复/, /怎么回/, /怎么跟.{0,6}说/, /沟通/, /谈判/, /说服/, /措辞/],
  extracting: [/提取/, /抽取/, /结构化/, /整理成表格/, /转成表格/, /字段提取/, /信息抽取/],
}

export interface IntentDetectResult {
  /** 命中的意图标签（可多个） */
  intents: RoleIntent[]
  /** 命中明细（供调试） */
  hits: Array<{ intent: RoleIntent; pattern: string }>
}

/**
 * 识别用户消息中的意图标签
 *
 * 规则实现意味着精度有限，因此设计上它只是规则层匹配的加分项
 * （+0.3），不单独决定命中，误判的代价可控。
 */
export function detectRoleIntents(message: string): IntentDetectResult {
  const text = message.toLowerCase()
  const intents: RoleIntent[] = []
  const hits: IntentDetectResult['hits'] = []

  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as Array<[RoleIntent, RegExp[]]>) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        intents.push(intent)
        hits.push({ intent, pattern: String(pattern) })
        break
      }
    }
  }

  return { intents, hits }
}
