/**
 * 压缩后的完整性校验
 *
 * 压缩必然会丢东西，但有两类内容一条都不能丢：
 *
 * - **用户原话**（含执行中插话）：原始意图不可再生，丢了就是「AI 忘了我要什么」；
 * - **规则类消息**（系统约束、场景边界、计划阶段硬性要求）：丢了会让模型越界。
 *
 * 丢了怎么办？放回它在完整历史里的**原位置**，而不是补到末尾 —— 补到末尾会把
 * 「早先的要求」变成「最新的要求」，时序错乱比丢失更糟。
 *
 * 还有一条必须遵守的序列约束：不能插在 `tool_call` 与其对应 `tool_result` 之间，
 * 否则消息序列非法，请求直接被服务商拒掉。
 *
 * @module capabilities/context/contextRecovery
 */

/** 消息最小结构（只依赖角色与内容，方便单测） */
export interface RecoverableMessage {
  role: string
  content?: unknown
  tool_calls?: unknown[]
  tool_call_id?: string
}

/** 校验结果 */
export interface IntegrityReport {
  ok: boolean
  /** 丢失的用户消息（内容指纹） */
  missingUserMessages: string[]
  /** 丢失的规则类消息 */
  missingRuleMessages: string[]
}

/** 恢复结果 */
export interface RecoveryResult<T extends RecoverableMessage> {
  messages: T[]
  /** 实际放回的条数 */
  restored: number
  /** 因无法安全定位而放弃放回的条数 */
  skipped: number
}

/** 规则类消息的识别特征：这些前缀是「要求」而不是「内容」 */
const RULE_MARKERS = [
  '【计划阶段硬性要求】',
  '【进度自查】',
  '【本轮为最后一轮】',
  '【用户在执行中补充了说明',
  '【系统约束',
  '【场景边界',
]

/** 取内容文本；非字符串一律视为空 */
function textOf(msg: RecoverableMessage): string {
  return typeof msg.content === 'string' ? msg.content : ''
}

/** 内容指纹：前 80 字 + 长度，避免整段比对 */
function fingerprintOf(msg: RecoverableMessage): string {
  const text = textOf(msg).replace(/\s+/g, ' ').trim()
  return `${text.slice(0, 80)}#${text.length}`
}

/** 是否为需要保护的用户原话 */
function isUserUtterance(msg: RecoverableMessage): boolean {
  if (msg.role !== 'user') return false
  const text = textOf(msg).trim()
  if (!text) return false
  // 规则类消息也走 user 角色，但它们由规则通道保护，不重复计入「用户原话」
  return !RULE_MARKERS.some((m) => text.startsWith(m))
}

/** 是否为规则类消息 */
function isRuleMessage(msg: RecoverableMessage): boolean {
  const text = textOf(msg).trim()
  if (!text) return false
  if (RULE_MARKERS.some((m) => text.startsWith(m))) return true
  return msg.role === 'system'
}

/**
 * 校验压缩是否丢了不可丢的内容
 *
 * @param original   压缩前的完整消息序列
 * @param compressed 压缩后的消息序列
 */
export function verifyCompressionIntegrity(
  original: RecoverableMessage[],
  compressed: RecoverableMessage[],
): IntegrityReport {
  const kept = new Set(compressed.map(fingerprintOf))

  const missingUserMessages: string[] = []
  const missingRuleMessages: string[] = []

  const seen = new Set<string>()
  for (const msg of original) {
    const fp = fingerprintOf(msg)
    // 同一条消息可能出现多次（重复插入），只报一次
    if (seen.has(fp)) continue
    seen.add(fp)
    if (isUserUtterance(msg) && !kept.has(fp)) missingUserMessages.push(fp)
    else if (isRuleMessage(msg) && !kept.has(fp)) missingRuleMessages.push(fp)
  }

  return {
    ok: missingUserMessages.length === 0 && missingRuleMessages.length === 0,
    missingUserMessages,
    missingRuleMessages,
  }
}

/** 该消息是否为待配对的工具请求 */
function isToolCallMessage(msg: RecoverableMessage): boolean {
  return Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0
}

/** 该消息是否为工具结果 */
function isToolResultMessage(msg: RecoverableMessage): boolean {
  return msg.role === 'tool' || typeof msg.tool_call_id === 'string'
}

/**
 * 把丢失的受保护消息放回原位置
 *
 * 定位策略：在压缩后的序列里找「原序列中它前一条仍存在的消息」，插在那条之后。
 * 找不到前驱（前面全被裁掉）就插到序列最前 —— 那本来就是它最接近的位置。
 *
 * 安全约束：定位点若落在 tool_call 与其 tool_result 之间，向前回退到
 * 那组调用的起点之前，保证序列合法。
 */
export function restoreIntoSafePosition<T extends RecoverableMessage>(
  original: T[],
  compressed: T[],
): RecoveryResult<T> {
  const report = verifyCompressionIntegrity(original, compressed)
  if (report.ok) return { messages: compressed, restored: 0, skipped: 0 }

  const targets = new Set([...report.missingUserMessages, ...report.missingRuleMessages])
  const result = [...compressed]
  let restored = 0
  let skipped = 0

  // 按原序列顺序处理，保证多次恢复后的相对顺序仍然正确
  for (let i = 0; i < original.length; i += 1) {
    const msg = original[i]
    const fp = fingerprintOf(msg)
    if (!targets.has(fp)) continue

    // 找前驱：原序列中往前第一个在结果里存在的消息
    let insertAt = 0
    for (let j = i - 1; j >= 0; j -= 1) {
      const prevFp = fingerprintOf(original[j])
      const idx = result.findIndex((m) => fingerprintOf(m) === prevFp)
      if (idx >= 0) {
        insertAt = idx + 1
        break
      }
    }

    // 不能插在 tool_call 与 tool_result 之间：
    // 若插入点前后正是这种配对，回退到 tool_call 之前
    if (insertAt > 0 && insertAt < result.length) {
      const before = result[insertAt - 1]
      const after = result[insertAt]
      if (isToolCallMessage(before) && isToolResultMessage(after)) {
        insertAt -= 1
      }
    }

    if (insertAt < 0 || insertAt > result.length) {
      skipped += 1
      continue
    }

    result.splice(insertAt, 0, msg)
    restored += 1
  }

  return { messages: result, restored, skipped }
}

/**
 * 校验消息序列是否合法（tool_call 必须紧跟对应 tool_result）
 *
 * 用于恢复后的兜底检查：宁可拒绝这次恢复，也不能发出非法序列。
 */
export function isSequenceValid(messages: RecoverableMessage[]): boolean {
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]
    if (!isToolCallMessage(msg)) continue
    const expected = new Set(
      (msg.tool_calls as Array<{ id?: string }> | undefined)
        ?.map((c) => c?.id)
        .filter((id): id is string => typeof id === 'string') ?? [],
    )
    // 紧随其后应连续出现对应 tool 消息；允许中间夹 tool 结果以外的内容时判定为非法
    let j = i + 1
    const seen = new Set<string>()
    while (j < messages.length && isToolResultMessage(messages[j])) {
      const id = messages[j].tool_call_id
      if (id) seen.add(id)
      j += 1
    }
    for (const id of expected) {
      if (!seen.has(id)) return false
    }
  }
  return true
}

/**
 * 压缩前快照：只留不可丢的两类消息
 *
 * 注意是浅拷贝：内容字符串本身不可变，快照只需要保证「这一段序列」不会因
 * 压缩时的原地修改而消失。
 */
export function snapshotProtected<T extends RecoverableMessage>(messages: T[]): T[] {
  return messages
    .filter((m) => isUserUtterance(m) || isRuleMessage(m))
    .map((m) => ({ ...m }))
}

/**
 * 压缩后就地恢复被误删的受保护消息
 *
 * 返回恢复统计；恢复后序列非法时整体回滚，宁可丢信息也不发出非法序列。
 */
export function restoreProtectedInPlace<T extends RecoverableMessage>(
  messages: T[],
  snapshot: T[],
): { restored: number; skipped: number; rolledBack: boolean } {
  if (snapshot.length === 0 || messages.length === 0) {
    return { restored: 0, skipped: 0, rolledBack: false }
  }

  const result = restoreIntoSafePosition(snapshot, messages)
  if (result.restored === 0) {
    return { restored: 0, skipped: result.skipped, rolledBack: false }
  }

  if (!isSequenceValid(result.messages)) {
    // 放回后序列非法：撤销这次恢复，保持压缩后的原样
    return { restored: 0, skipped: result.restored, rolledBack: true }
  }

  messages.splice(0, messages.length, ...result.messages)
  return { restored: result.restored, skipped: result.skipped, rolledBack: false }
}
