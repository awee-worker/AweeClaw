/**
 * 工具分层懒展开
 *
 * 问题很具体：一次下发几十个工具 schema，每轮都要重发，且工具越多模型选错的概率越高。
 * 解法是「收着发、用到再展开」：
 *
 * - 常在层：不属于任何组的工具，始终全量下发。
 * - 分组层：组内工具数达到阈值时才收缩，只发该组一个「入口工具」+ 说明；
 *   第一次调用入口工具或组内工具后，该组在后续轮次展开成全量。
 *
 * 硬约束：**只过滤，不重排**。展开时新出现的工具追加在原来的相对位置不变，
 * 不会把已有工具挤到别处 —— 否则 prompt cache 的前缀每轮都失效，省下的 token
 * 会全部被缓存未命中吃回去。
 *
 * 只对「名字能可靠判定归属、且组内工具足够多」的组生效。判定不确定的（例如
 * 第三方插件工具）一律不收缩：把工具藏错比多发几个 schema 的代价大得多。
 *
 * @module intelligence/engine/toolExpansion
 */

/** 工具定义的最小结构（只依赖名字与描述，便于测试与解耦） */
export interface ExpandableToolDefinition {
  name: string
  description?: string
}

/** 一个可收缩的工具组 */
export interface ToolGroupRule {
  /** 组标识 */
  id: string
  /** 组名（写进入口工具说明） */
  label: string
  /** 归属判定 */
  match: (name: string) => boolean
  /**
   * 入口工具名
   *
   * 必须是组里**最常被先用到**的那个，而不是最"概括"的那个 ——
   * 入口选错会让高频操作多绕一步，比不收缩更糟。
   */
  entryTool: string
}

/**
 * 启用的分组规则
 *
 * 每条都要满足两个前提才值得开启：
 * 1. 组内工具数 ≥ MIN_GROUP_SIZE（太小的组收缩没有收益）；
 * 2. 入口工具确实存在（缺失时该组自动跳过，不会把整组藏起来）。
 */
export const TOOL_GROUP_RULES: ToolGroupRule[] = [
  {
    id: 'git',
    label: 'Git 版本控制',
    match: (name) => name.startsWith('git_'),
    entryTool: 'git_status',
  },
  {
    id: 'pptx',
    label: 'PPT 生成',
    match: (name) => name.startsWith('mcp_plugin_mcp-pptx__'),
    entryTool: 'mcp_plugin_mcp-pptx__list_ppt_templates',
  },
  {
    id: 'diagram',
    label: '架构图与思维导图',
    match: (name) => name.startsWith('mcp_plugin_diagram-gen__'),
    entryTool: 'mcp_plugin_diagram-gen__generate_diagram',
  },
]

/** 组内工具少于此数就不值得收缩 */
export const MIN_GROUP_SIZE = 3

/** 追加在入口工具说明末尾的提示：不写这句，模型不知道入口能解锁更多 */
const ENTRY_HINT = '（调用本工具后，本组其他同类工具会在下一轮可用）'

/** 一次任务内的展开状态 */
export interface ToolExpansionState {
  /** 已展开的组 id */
  expanded: Set<string>
  /** 当前实际生效的组（建表时校验过入口存在且组够大） */
  activeGroups: Array<{ rule: ToolGroupRule; toolNames: Set<string> }>
  /** 按当前状态过滤工具列表；保序，只做删减与入口说明注入 */
  filter: (defs: ExpandableToolDefinition[]) => ExpandableToolDefinition[]
  /** 记录本轮发生的工具调用：命中组内任意工具即展开该组 */
  noteCalls: (toolNames: string[]) => void
  /** 重置（新任务 / 新会话） */
  reset: () => void
}

/**
 * 创建展开状态
 *
 * @param allToolNames 本次可用的全部工具名（用来校验入口是否存在、统计组大小）
 */
export function createToolExpansionState(
  allToolNames: string[],
  rules: ToolGroupRule[] = TOOL_GROUP_RULES,
): ToolExpansionState {
  const nameSet = new Set(allToolNames)
  const activeGroups = rules
    .map((rule) => ({
      rule,
      toolNames: new Set(allToolNames.filter((n) => rule.match(n))),
    }))
    .filter(({ rule, toolNames }) => toolNames.size >= MIN_GROUP_SIZE && nameSet.has(rule.entryTool))

  const expanded = new Set<string>()

  /** 组内工具名 → 组 id，用于 noteCalls 快速判定 */
  const ownerOf = new Map<string, string>()
  for (const { rule, toolNames } of activeGroups) {
    for (const name of toolNames) ownerOf.set(name, rule.id)
  }

  return {
    expanded,
    activeGroups,

    filter<T extends ExpandableToolDefinition>(defs: T[]): T[] {
      if (activeGroups.length === 0) return defs
      /** 需要隐藏的工具名 → 所属组 */
      const hidden = new Set<string>()
      for (const { rule, toolNames } of activeGroups) {
        if (expanded.has(rule.id)) continue
        for (const name of toolNames) {
          if (name !== rule.entryTool) hidden.add(name)
        }
      }
      if (hidden.size === 0) return defs

      return defs
        .filter((d) => !hidden.has(d.name))
        .map((d) => {
          // 给入口工具补一句「能解锁本组其他工具」，否则模型不知道要先用它
          const owner = ownerOf.get(d.name)
          if (!owner) return d
          const group = activeGroups.find((g) => g.rule.id === owner)
          if (!group || d.name !== group.rule.entryTool) return d
          if ((d.description || '').includes(ENTRY_HINT)) return d
          return { ...d, description: `${d.description || ''}${ENTRY_HINT}` }
        })
    },

    noteCalls(toolNames) {
      for (const name of toolNames) {
        const owner = ownerOf.get(name)
        if (owner && !expanded.has(owner)) {
          expanded.add(owner)
        }
      }
    },

    reset() {
      expanded.clear()
    },
  }
}
