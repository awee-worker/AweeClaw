/**
 * 敏感内容识别（主进程 / 渲染进程共用）
 *
 * 记忆在两条路径上都要判定是否敏感：
 *  - 本地落库（主进程）：命中则加密后写入 SQLite，避免明文躺在磁盘上；
 *  - 推送云端（渲染进程）：命中则拦截，避免明文离开本机。
 *
 * 规则集中放在这里，保证两侧口径一致，不会因某一侧改动而漂移。
 */

/** 敏感内容匹配规则：命中任意一条即视为敏感 */
export interface SensitiveRule {
  /** 敏感类型，用于提示与日志 */
  type: string
  pattern: RegExp
}

export const SENSITIVE_RULES: SensitiveRule[] = [
  { type: '身份证号', pattern: /(?<!\d)\d{17}[\dXx](?!\d)/ },
  { type: '手机号', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/ },
  { type: '银行卡号', pattern: /(?<!\d)\d{16,19}(?!\d)/ },
  { type: '邮箱', pattern: /[\w.+-]+@[\w-]+(\.[\w-]+)+/ },
  {
    type: '密码/密钥',
    pattern:
      /(密码|口令|password|passwd|pwd|密钥|私钥|secret|api[_-]?key|access[_-]?key|access[_-]?token|auth[_-]?token|bearer)\s*[:=：是]\s*\S+/i,
  },
  {
    type: '车牌号',
    pattern: /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-Z0-9]{5,6}/,
  },
  {
    type: '隐私关键词',
    pattern: /(身份证|银行卡|信用卡|社保|公积金|护照|驾驶证|病历|诊断|处方|家庭住址|详细地址)/,
  },
]

/** 显式声明为敏感的标签，命中即整条按敏感处理 */
export const SENSITIVE_TAGS = ['sensitive', 'private', 'secret', '隐私', '敏感']

/**
 * 判定内容是否包含敏感信息。
 * @returns 命中的敏感类型，非敏感返回 null
 */
export function detectSensitiveContent(content: string | null | undefined): string | null {
  if (!content) return null
  for (const rule of SENSITIVE_RULES) {
    if (rule.pattern.test(content)) return rule.type
  }
  return null
}

/**
 * 标签中是否显式声明了敏感。
 * 兼容两种入参：数据库里的 JSON 字符串，或已解析的字符串数组。
 */
export function hasSensitiveTag(tags?: string | string[] | null): boolean {
  if (!tags) return false
  const list = Array.isArray(tags) ? tags : [tags]
  return list.some((tag) => {
    const lower = tag.toLowerCase()
    return SENSITIVE_TAGS.some((sensitive) => lower.includes(sensitive))
  })
}
