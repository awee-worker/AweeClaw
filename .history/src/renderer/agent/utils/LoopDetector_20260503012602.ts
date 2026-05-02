/**
 * Smarter loop detection for agent tool calls.
 *
 * Goals:
 * 1. Detect genuinely stuck behavior instead of just counting calls.
 * 2. Respect runtime configuration as the single threshold source.
 * 3. Treat "too many calls to the same tool" as a warning, not a hard stop.
 * 4. Support progressive warnings before hard stops.
 * 5. Detect semantic-level loops (similar operations on related targets).
 * 6. Properly handle MCP tools and directory exploration patterns.
 */

import { logger } from '@utils/Logger'
import type { LLMToolCall } from '@/shared/types'
import { getAgentConfig } from './AgentConfig'

interface ToolCallRecord {
  name: string
  target: string | null
  argsHash: string
  contentHash?: string
  timestamp: number
  success: boolean
}

export interface LoopCheckResult {
  isLoop: boolean
  reason?: string
  suggestion?: string
  warning?: string
  details?: {
    category: 'exact_repeat' | 'same_tool_warning' | 'same_target_warning' | 'content_cycle' | 'pattern_loop' | 'semantic_loop'
    toolName?: string
    count?: number
    threshold?: number
    target?: string | null
    pattern?: string
    severity?: 'low' | 'medium' | 'high'
  }
}

interface LoopDetectorInternalConfig {
  timeWindowMs: number
  maxExactRepeats: number
  maxNoChangeEdits: number
  maxSameToolCallsWarning: number
  maxSameTargetCalls: number
  maxHistory: number
  minPatternLength: number
  maxPatternLength: number
  readOpMultiplier: number
  dynamicThreshold: boolean
  progressiveWarningRatio: number
  semanticSimilarityThreshold: number
}

function getLoopConfig(): LoopDetectorInternalConfig {
  const agentConfig = getAgentConfig()
  const loopConfig = agentConfig.loopDetection

  return {
    timeWindowMs: 3 * 60 * 1000,
    maxExactRepeats: loopConfig.maxExactRepeats,
    maxNoChangeEdits: loopConfig.maxSameTargetRepeats,
    maxSameToolCallsWarning: Math.max(
      agentConfig.maxToolLoops,
      loopConfig.maxSameTargetRepeats * 3,
      loopConfig.maxExactRepeats * 5
    ),
    maxSameTargetCalls: loopConfig.maxSameTargetRepeats,
    maxHistory: loopConfig.maxHistory,
    minPatternLength: 2,
    maxPatternLength: 4,
    readOpMultiplier: 4,
    dynamicThreshold: loopConfig.dynamicThreshold ?? true,
    progressiveWarningRatio: 0.6,
    semanticSimilarityThreshold: 0.7,
  }
}

const READ_OPERATIONS = new Set([
  'read_file',
  'read_multiple_files',
  'list_directory',
  'get_dir_tree',
  'search_files',
  'grep_search',
  'codebase_search',
  'find_references',
  'go_to_definition',
  'get_hover_info',
  'get_document_symbols',
  'get_file_info',
])

const WRITE_OPERATIONS = new Set([
  'edit_file',
  'write_file',
  'replace_file_content',
  'create_file_or_folder',
  'delete_file_or_folder',
  'run_command',
])

const SEARCH_OPERATIONS = new Set([
  'search_files',
  'grep_search',
  'codebase_search',
  'find_references',
])

function isReadOperation(name: string): boolean {
  if (READ_OPERATIONS.has(name)) return true
  if (name.startsWith('mcp_')) {
    const lower = name.toLowerCase()
    return lower.includes('query') || lower.includes('read') || lower.includes('list') ||
      lower.includes('search') || lower.includes('get') || lower.includes('fetch') ||
      lower.includes('select') || lower.includes('describe') || lower.includes('show')
  }
  return false
}

function isWriteOperation(name: string): boolean {
  if (WRITE_OPERATIONS.has(name)) return true
  if (name.startsWith('mcp_')) {
    const lower = name.toLowerCase()
    return lower.includes('insert') || lower.includes('update') || lower.includes('delete') ||
      lower.includes('create') || lower.includes('write') || lower.includes('edit') ||
      lower.includes('drop') || lower.includes('alter') || lower.includes('execute')
  }
  return false
}

function isSearchOperation(name: string): boolean {
  if (SEARCH_OPERATIONS.has(name)) return true
  if (name.startsWith('mcp_')) {
    const lower = name.toLowerCase()
    return lower.includes('search') || lower.includes('find') || lower.includes('query')
  }
  return false
}

function getToolCategory(name: string): 'read' | 'write' | 'search' | 'other' {
  if (isSearchOperation(name)) return 'search'
  if (isReadOperation(name)) return 'read'
  if (isWriteOperation(name)) return 'write'
  return 'other'
}

export class LoopDetector {
  private history: ToolCallRecord[] = []
  private contentHashes: Map<string, string[]> = new Map()
  private warningEmitted: Set<string> = new Set()

  private get config(): LoopDetectorInternalConfig {
    return getLoopConfig()
  }

  checkLoop(
    toolCalls: LLMToolCall[],
    fileContents?: Map<string, string>
  ): LoopCheckResult {
    const now = Date.now()
    this.cleanupOldRecords(now)

    for (const tc of toolCalls) {
      const record = this.createRecord(tc, fileContents)

      const progressiveResult = this.checkProgressiveWarning(record)
      if (progressiveResult) return progressiveResult

      const exactResult = this.checkExactRepeat(record)
      if (exactResult.isLoop || exactResult.warning) {
        return exactResult
      }

      const sameTargetResult = this.checkSameTargetRepeat(record)
      if (sameTargetResult.isLoop || sameTargetResult.warning) {
        return sameTargetResult
      }

      if (isWriteOperation(tc.name) && record.target) {
        const contentResult = this.checkContentChange(record)
        if (contentResult.isLoop) {
          return contentResult
        }
      }

      const patternResult = this.checkPatternLoop(record)
      if (patternResult.isLoop) {
        return patternResult
      }

      const semanticResult = this.checkSemanticLoop(record)
      if (semanticResult.isLoop || semanticResult.warning) {
        return semanticResult
      }
    }

    return { isLoop: false }
  }

  recordExecutedTool(
    toolCall: Pick<LLMToolCall, 'name' | 'arguments'>,
    success: boolean,
    fileContents?: Map<string, string>
  ): void {
    const record = this.createRecord(toolCall, fileContents)
    record.success = success
    this.history.push(record)

    if (this.history.length > this.config.maxHistory) {
      this.history = this.history.slice(-this.config.maxHistory)
    }
  }

  updateContentHash(filePath: string, content: string): void {
    const hash = this.hashContent(content)
    this.pushContentHash(filePath, hash)
  }

  updateContentHashBySignature(filePath: string, hash: string): void {
    this.pushContentHash(filePath, hash)
  }

  private pushContentHash(filePath: string, hash: string): void {
    const hashes = this.contentHashes.get(filePath) || []
    hashes.push(hash)
    if (hashes.length > 10) {
      hashes.shift()
    }
    this.contentHashes.set(filePath, hashes)
  }

  reset(): void {
    this.history = []
    this.contentHashes.clear()
    this.warningEmitted.clear()
  }

  private createRecord(
    tc: Pick<LLMToolCall, 'name' | 'arguments'>,
    fileContents?: Map<string, string>
  ): ToolCallRecord {
    const args = (tc.arguments || {}) as Record<string, unknown>
    const rawTarget = args.path || args.file || args.command || args.query || args.sql || args.url || null
    const target = typeof rawTarget === 'string' ? rawTarget : null

    let contentHash: string | undefined
    if (target && fileContents?.has(target)) {
      contentHash = this.hashContent(fileContents.get(target)!)
    }

    return {
      name: tc.name,
      target,
      argsHash: this.hashArgs(tc.arguments),
      contentHash,
      timestamp: Date.now(),
      success: true,
    }
  }

  private cleanupOldRecords(now: number): void {
    const cutoff = now - this.config.timeWindowMs
    this.history = this.history.filter(record => record.timestamp > cutoff)

    if (this.history.length > this.config.maxHistory) {
      this.history = this.history.slice(-this.config.maxHistory)
    }
  }

  private checkProgressiveWarning(record: ToolCallRecord): LoopCheckResult | null {
    const category = getToolCategory(record.name)
    const isRead = category === 'read' || category === 'search'
    const config = this.config

    let threshold = isRead
      ? config.maxExactRepeats * config.readOpMultiplier
      : config.maxExactRepeats

    if (config.dynamicThreshold) {
      const complexity = this.estimateTaskComplexity()
      if (complexity > 0.7) {
        threshold = Math.floor(threshold * 1.5)
      }
    }

    const warningThreshold = Math.floor(threshold * config.progressiveWarningRatio)
    const exactMatches = this.history.filter(
      entry => entry.name === record.name && entry.argsHash === record.argsHash
    )

    const warningKey = `progressive_${record.name}_${record.argsHash}`
    if (exactMatches.length >= warningThreshold && !this.warningEmitted.has(warningKey)) {
      this.warningEmitted.add(warningKey)
      return {
        isLoop: false,
        warning: `Tool "${record.name}" with same arguments is approaching loop threshold (${exactMatches.length + 1}/${threshold}).`,
        suggestion: isRead
          ? 'Consider whether you already have the information you need from previous reads.'
          : 'Consider whether this operation is making progress or if a different approach is needed.',
        details: {
          category: 'same_tool_warning',
          toolName: record.name,
          count: exactMatches.length + 1,
          threshold,
          target: record.target,
          severity: 'low',
        },
      }
    }

    return null
  }

  private checkExactRepeat(record: ToolCallRecord): LoopCheckResult {
    const category = getToolCategory(record.name)
    const isRead = category === 'read' || category === 'search'
    const config = this.config

    let threshold = isRead
      ? config.maxExactRepeats * config.readOpMultiplier
      : config.maxExactRepeats

    if (config.dynamicThreshold) {
      const complexity = this.estimateTaskComplexity()
      if (complexity > 0.7) {
        threshold = Math.floor(threshold * 1.5)
        logger.agent.info(
          `[LoopDetector] Dynamic threshold adjusted: ${threshold} (complexity: ${complexity.toFixed(2)})`
        )
      }
    }

    const exactMatches = this.history.filter(
      entry => entry.name === record.name && entry.argsHash === record.argsHash
    )

    if (exactMatches.length >= threshold) {
      return {
        isLoop: true,
        reason: `Detected exact repeat of ${record.name} (${exactMatches.length + 1} times with identical arguments).`,
        suggestion: isRead
          ? 'The file content may not have changed. Consider a different approach.'
          : 'The same operation has been attempted multiple times. Please try a different approach.',
        details: {
          category: 'exact_repeat',
          toolName: record.name,
          count: exactMatches.length + 1,
          threshold,
          target: record.target,
          severity: 'high',
        },
      }
    }

    const sameToolCalls = this.history.filter(entry => entry.name === record.name)
    if (sameToolCalls.length === config.maxSameToolCallsWarning) {
      const warningKey = `same_tool_${record.name}`
      if (!this.warningEmitted.has(warningKey)) {
        this.warningEmitted.add(warningKey)
        return {
          isLoop: false,
          warning: `Tool "${record.name}" has been called ${sameToolCalls.length + 1} times. This may indicate a loop.`,
          suggestion: 'Consider whether a different tool or a broader batch operation would make better progress.',
          details: {
            category: 'same_tool_warning',
            toolName: record.name,
            count: sameToolCalls.length + 1,
            threshold: config.maxSameToolCallsWarning + 1,
            target: record.target,
            severity: 'medium',
          },
        }
      }
    }

    return { isLoop: false }
  }

  private checkSameTargetRepeat(record: ToolCallRecord): LoopCheckResult {
    if (!record.target) return { isLoop: false }

    const config = this.config
    const sameTargetCalls = this.history.filter(
      entry => entry.target === record.target && entry.name === record.name
    )

    if (sameTargetCalls.length >= config.maxSameTargetCalls) {
      const isRead = isReadOperation(record.name)
      if (isRead) {
        const warningKey = `same_target_${record.name}_${record.target}`
        if (!this.warningEmitted.has(warningKey)) {
          this.warningEmitted.add(warningKey)
          return {
            isLoop: false,
            warning: `Tool "${record.name}" on "${record.target}" has been called ${sameTargetCalls.length + 1} times.`,
            suggestion: 'You may already have the information from previous reads. Try using what you already know.',
            details: {
              category: 'same_target_warning',
              toolName: record.name,
              count: sameTargetCalls.length + 1,
              threshold: config.maxSameTargetCalls,
              target: record.target,
              severity: 'medium',
            },
          }
        }
      } else {
        return {
          isLoop: true,
          reason: `Tool "${record.name}" on "${record.target}" has been called ${sameTargetCalls.length + 1} times without progress.`,
          suggestion: 'The same write operation on the same target is not making progress. Review your approach.',
          details: {
            category: 'exact_repeat',
            toolName: record.name,
            count: sameTargetCalls.length + 1,
            threshold: config.maxSameTargetCalls,
            target: record.target,
            severity: 'high',
          },
        }
      }
    }

    return { isLoop: false }
  }

  private checkContentChange(record: ToolCallRecord): LoopCheckResult {
    if (!record.target) {
      return { isLoop: false }
    }

    const hashes = this.contentHashes.get(record.target) || []
    if (hashes.length < 2) {
      return { isLoop: false }
    }

    const recentHashes = hashes.slice(-this.config.maxNoChangeEdits)
    const uniqueHashes = new Set(recentHashes)

    if (recentHashes.length >= this.config.maxNoChangeEdits && uniqueHashes.size <= 2) {
      return {
        isLoop: true,
        reason: `File "${record.target}" content is cycling between ${uniqueHashes.size} state(s) after ${recentHashes.length} edits.`,
        suggestion: 'The edits are not making progress. Consider reviewing the approach or asking for clarification.',
        details: {
          category: 'content_cycle',
          count: recentHashes.length,
          threshold: this.config.maxNoChangeEdits,
          target: record.target,
          severity: 'high',
        },
      }
    }

    return { isLoop: false }
  }

  private checkPatternLoop(newRecord: ToolCallRecord): LoopCheckResult {
    const tempHistory = [...this.history, newRecord]

    for (let len = this.config.minPatternLength; len <= this.config.maxPatternLength; len++) {
      if (tempHistory.length < len * 2) {
        continue
      }

      const recent = tempHistory.slice(-len * 2)
      const firstHalf = recent.slice(0, len)
      const secondHalf = recent.slice(len)

      const isExactPattern = firstHalf.every((recordItem, index) =>
        recordItem.name === secondHalf[index].name &&
        recordItem.argsHash === secondHalf[index].argsHash
      )

      if (isExactPattern && !this.isPathExploration(firstHalf, secondHalf)) {
        const pattern = firstHalf.map(item => `${item.name}(${item.target || 'N/A'})`).join(' -> ')
        return {
          isLoop: true,
          reason: `Detected repeating pattern: ${pattern} (repeated 2 times).`,
          suggestion: 'The agent is stuck in a loop. Consider breaking the pattern with a different approach.',
          details: {
            category: 'pattern_loop',
            pattern,
            count: 2,
            threshold: 2,
            severity: 'high',
          },
        }
      }

      const isFuzzyPattern = firstHalf.every((recordItem, index) => {
        if (recordItem.name !== secondHalf[index].name) return false
        if (recordItem.argsHash === secondHalf[index].argsHash) return true
        return this.areSimilarTargets(recordItem.target, secondHalf[index].target)
      })

      if (isFuzzyPattern && !this.isPathExploration(firstHalf, secondHalf)) {
        const warningKey = `fuzzy_pattern_${firstHalf.map(r => r.name).join('_')}`
        if (!this.warningEmitted.has(warningKey)) {
          this.warningEmitted.add(warningKey)
          const pattern = firstHalf.map(item => `${item.name}(${item.target || 'N/A'})`).join(' -> ')
          return {
            isLoop: false,
            warning: `Detected a similar pattern repeating: ${pattern}`,
            suggestion: 'The agent may be stuck in a loop with slightly different arguments. Consider a different strategy.',
            details: {
              category: 'pattern_loop',
              pattern,
              count: 2,
              threshold: 2,
              severity: 'medium',
            },
          }
        }
      }
    }

    return { isLoop: false }
  }

  private checkSemanticLoop(record: ToolCallRecord): LoopCheckResult {
    const recentRecords = this.history.slice(-20)

    const sameCategoryRecords = recentRecords.filter(
      entry => getToolCategory(entry.name) === getToolCategory(record.name) && entry.name !== record.name
    )

    if (sameCategoryRecords.length >= 6) {
      const uniqueTargets = new Set(
        sameCategoryRecords.filter(r => r.target).map(r => r.target)
      )

      if (record.target && uniqueTargets.size <= 3 && sameCategoryRecords.length >= 8) {
        const warningKey = `semantic_${getToolCategory(record.name)}_${[...uniqueTargets].join('_')}`
        if (!this.warningEmitted.has(warningKey)) {
          this.warningEmitted.add(warningKey)
          return {
            isLoop: false,
            warning: `Multiple ${getToolCategory(record.name)} operations on few targets (${uniqueTargets.size} targets, ${sameCategoryRecords.length + 1} calls).`,
            suggestion: 'Consider whether you are gathering new information or revisiting already-known content.',
            details: {
              category: 'semantic_loop',
              toolName: record.name,
              count: sameCategoryRecords.length + 1,
              target: record.target,
              severity: 'low',
            },
          }
        }
      }
    }

    return { isLoop: false }
  }

  private isPathExploration(firstHalf: ToolCallRecord[], secondHalf: ToolCallRecord[]): boolean {
    const allSameTool = firstHalf.every((record, index) => record.name === secondHalf[index].name)
    if (!allSameTool) {
      return false
    }

    const hasTargets = firstHalf.every((record, index) => record.target && secondHalf[index].target)
    if (!hasTargets) {
      return false
    }

    for (let i = 0; i < firstHalf.length; i++) {
      const path1 = firstHalf[i].target!
      const path2 = secondHalf[i].target!
      if (path1 !== path2 && this.isSubPath(path1, path2)) {
        return true
      }
    }

    const allTargets = [...firstHalf, ...secondHalf].map(r => r.target!)
    const uniqueTargets = new Set(allTargets)
    if (uniqueTargets.size > firstHalf.length) {
      return true
    }

    if (firstHalf.every(r => isSearchOperation(r.name)) && secondHalf.every(r => isSearchOperation(r.name))) {
      return true
    }

    return false
  }

  private areSimilarTargets(target1: string | null, target2: string | null): boolean {
    if (!target1 || !target2) return false
    if (target1 === target2) return true

    const norm1 = target1.replace(/\\/g, '/').toLowerCase()
    const norm2 = target2.replace(/\\/g, '/').toLowerCase()

    const dir1 = norm1.substring(0, norm1.lastIndexOf('/'))
    const dir2 = norm2.substring(0, norm2.lastIndexOf('/'))
    if (dir1 && dir2 && dir1 === dir2) return true

    const ext1 = norm1.substring(norm1.lastIndexOf('.'))
    const ext2 = norm2.substring(norm2.lastIndexOf('.'))
    if (ext1 && ext2 && ext1 === ext2 && dir1 === dir2) return true

    return false
  }

  private isSubPath(path1: string, path2: string): boolean {
    const normalized1 = path1.replace(/\\/g, '/').toLowerCase()
    const normalized2 = path2.replace(/\\/g, '/').toLowerCase()
    return normalized1.startsWith(normalized2) || normalized2.startsWith(normalized1)
  }

  private hashArgs(args: Record<string, unknown>): string {
    const normalized = JSON.stringify(args, Object.keys(args).sort())
    return this.simpleHash(normalized)
  }

  private hashContent(content: string): string {
    return this.simpleHash(content)
  }

  private estimateTaskComplexity(): number {
    if (this.history.length < 5) {
      return 0
    }

    const uniqueTools = new Set(this.history.map(record => record.name)).size
    const toolDiversity = Math.min(uniqueTools / 10, 1)

    const uniqueTargets = new Set(
      this.history
        .filter(record => record.target)
        .map(record => record.target)
    ).size
    const targetDiversity = Math.min(uniqueTargets / 15, 1)

    const failureRate = this.history.filter(record => !record.success).length / this.history.length
    return toolDiversity * 0.4 + targetDiversity * 0.4 + failureRate * 0.2
  }

  private simpleHash(value: string): string {
    let hash = 0
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash |= 0
    }
    return hash.toString(36)
  }
}
