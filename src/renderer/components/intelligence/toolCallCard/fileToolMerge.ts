/**
 * 相邻同文件写入调用的合并
 *
 * 背景：AI 分段写同一个文件时会连续产生多条文件写入类调用，每条调用在消息流里
 * 各占一张卡片，界面上表现为「正在创建 index.js +20 / +15 / +10」重复堆叠。
 * 同一文件的连续写入本质上是同一件事的若干步，重复行既占空间也让进度难以读。
 *
 * 这里只做纯逻辑：把「相邻、同文件、同语义」的调用折叠成一组，由调用方只渲染
 * 代表卡片（组内最新一条），其余调用作为「写了几次」与 diff 的累加依据。
 *
 * 保守原则：出现以下任一情况立即断组，宁可多显示一张卡片，也不把不该合并的调用
 * 藏起来 ——
 *  - 等待用户批准：折叠后批准入口跟着消失，用户无从操作
 *  - 失败 / 被拒绝：错误卡片必须独立可见
 *  - 取不到文件路径：无从判定是否同一文件
 *  - 语义不同：edit 与 create/write 合并后卡片标题会与实际动作对不上
 *  - 中间夹了别的工具：只合并真正连续的写入
 */
import type { ToolCall } from '@intelligence/providerTypes'
import { needsDiffPreview } from '@configuration/toolDefinitions'
import { getPrimaryToolPath } from './helpers'

/** 同一文件的相邻调用折叠结果 */
export interface FileToolCallGroup {
  /**
   * 组内第一条调用的 id，用作渲染 key
   *
   * 合并过程中代表卡片会被后来的调用顶替，用 lead.id 作 key 会让整个卡片被卸载重建
   * 并重播入场动画；组内第一条 id 在一次连续写入里恒定。
   */
  key: string
  /** 承载渲染的调用：组内最新一条，内容与状态都是最终态 */
  lead: ToolCall
  /** 被折叠的调用，按调用顺序（不含 lead）；首条是整组写入的起点 */
  merged: ToolCall[]
}

/**
 * 路径规范化
 *
 * 只处理分隔符、重复斜杠与前导 ./，用于判定「是不是同一个文件」。
 * 不做大小写折叠：大小写敏感的文件系统上，A.ts 与 a.ts 是两个文件。
 */
function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '')
}

/**
 * 写入语义分类
 *
 * 与 FileChangeCard 的标题判定保持同一口径：edit_file 是「编辑」，其余写入类工具
 * 是「创建 / 写入」。两类动作的文案不同，合并到一起会让卡片说错自己在做什么。
 *
 * @returns 写入语义；非写入类工具返回 null
 */
function fileActionKind(toolName: string): 'edit' | 'write' | null {
  if (!needsDiffPreview(toolName)) return null
  return toolName === 'edit_file' ? 'edit' : 'write'
}

/** 是否处于正在执行的状态（这些调用的内容还会变，diff 只能取近似值） */
function isToolActive(tool: ToolCall): boolean {
  return tool.status === 'running' || tool.status === 'pending'
}

/** 该调用是否不可参与合并 */
function isFoldBlocker(tool: ToolCall, isAwaiting: (tool: ToolCall) => boolean): boolean {
  if (isAwaiting(tool)) return true
  if (tool.status === 'error' || tool.status === 'rejected') return true
  if (tool.error) return true
  return false
}

/**
 * 把工具调用序列切成「同文件写入」分组
 *
 * 非写入类工具、以及不可合并的写入类工具各自单独成组，并打断连续性：它们中间的
 * 写入不再与前面的写入合并，保证卡片顺序与真实调用顺序一致。
 *
 * @param tools 工具调用列表（按调用顺序）
 * @param isAwaiting 判断某个调用是否在等待用户批准
 * @returns 折叠后的分组列表，顺序与原始调用一致
 */
export function groupAdjacentFileTools(
  tools: readonly ToolCall[],
  isAwaiting: (tool: ToolCall) => boolean,
): FileToolCallGroup[] {
  const groups: FileToolCallGroup[] = []
  /** 当前可继续合并的写入组；null 表示上一条已经断组 */
  let openGroup: FileToolCallGroup | null = null

  for (const tool of tools) {
    const kind = fileActionKind(tool.name)
    const path = kind ? normalizePath(getPrimaryToolPath(tool.arguments ?? {})) : ''

    if (!kind || !path || isFoldBlocker(tool, isAwaiting)) {
      groups.push({ key: tool.id, lead: tool, merged: [] })
      openGroup = null
      continue
    }

    const previousLead = openGroup?.lead
    const continuesSameFile =
      !!previousLead &&
      normalizePath(getPrimaryToolPath(previousLead.arguments ?? {})) === path &&
      fileActionKind(previousLead.name) === kind

    if (openGroup && continuesSameFile) {
      // 旧代表降级为被折叠成员，新调用接管渲染（内容与状态都是最终态）
      openGroup.merged.push(openGroup.lead)
      openGroup.lead = tool
      continue
    }

    openGroup = { key: tool.id, lead: tool, merged: [] }
    groups.push(openGroup)
  }

  return groups
}

/**
 * 取整组写入的起点内容
 *
 * 合并后只渲染一张卡片，它的 diff 应当是「第一次写入前 → 最后一次写入后」的完整
 * 变化量：这样徽章上的 +N 就是这次连续写入的总增量，与折叠起来的行数一致。
 * 用组内最早一条调用的 oldContent 作为起点；没有更早成员时返回 null，
 * 调用方沿用卡片自己的 oldContent。
 *
 * @param merged 被折叠的调用（按调用顺序）
 * @returns 起点内容；无折叠成员时为 null
 */
export function resolveMergedBaseOldContent(merged: readonly ToolCall[] | undefined): string | null {
  const earliest = merged?.[0]
  if (!earliest) return null

  const meta = earliest.arguments?._meta as Record<string, unknown> | undefined
  if (meta?.oldContent !== undefined) return meta.oldContent as string

  // 流式编辑会带上被替换的片段，它才是最接近「写入前」的内容
  if (isToolActive(earliest) && typeof earliest.arguments?.old_string === 'string') {
    return earliest.arguments.old_string
  }

  return ''
}
