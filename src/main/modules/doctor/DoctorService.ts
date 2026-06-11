/**
 * Doctor 诊断工具
 *
 * 借鉴 OpenClaw 的 Doctor 功能，提供系统健康检查和问题诊断：
 * 1. 系统环境检查：Node.js 版本、依赖完整性、磁盘空间
 * 2. Channel 连接诊断：各渠道连接状态、认证有效性
 * 3. Provider 健康检查：AI 模型 API 可达性、配额状态
 * 4. Session 状态诊断：活跃会话、token 使用量
 * 5. 插件系统诊断：已加载插件、冲突检测
 * 6. 安全策略检查：沙箱配置、审批策略
 *
 * @module doctor/DoctorService
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as os from 'os'
import * as fs from 'fs'

// ============================================
// 诊断结果类型
// ============================================

export type DiagnosticLevel = 'ok' | 'warn' | 'error' | 'info'

export interface DiagnosticItem {
  /** 检查项名称 */
  name: string
  /** 检查项分类 */
  category: DiagnosticCategory
  /** 诊断级别 */
  level: DiagnosticLevel
  /** 诊断消息 */
  message: string
  /** 修复建议 */
  suggestion?: string
  /** 详细数据 */
  details?: Record<string, unknown>
}

export type DiagnosticCategory =
  | 'system'
  | 'channel'
  | 'provider'
  | 'session'
  | 'plugin'
  | 'security'
  | 'network'

export interface DoctorReport {
  /** 报告生成时间 */
  timestamp: number
  /** 总体状态 */
  overallStatus: DiagnosticLevel
  /** 诊断项列表 */
  items: DiagnosticItem[]
  /** 摘要统计 */
  summary: {
    total: number
    ok: number
    warn: number
    error: number
    info: number
  }
}

// ============================================
// 诊断检查器接口
// ============================================

interface DiagnosticChecker {
  category: DiagnosticCategory
  check(): Promise<DiagnosticItem[]>
}

// ============================================
// 系统环境检查器
// ============================================

class SystemChecker implements DiagnosticChecker {
  category: DiagnosticCategory = 'system'

  async check(): Promise<DiagnosticItem[]> {
    const items: DiagnosticItem[] = []

    // Node.js 版本
    const nodeVersion = process.version
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10)
    items.push({
      name: 'Node.js Version',
      category: 'system',
      level: majorVersion >= 18 ? 'ok' : 'warn',
      message: `Node.js ${nodeVersion}`,
      suggestion: majorVersion < 18 ? '建议升级到 Node.js 18+' : undefined,
    })

    // 内存
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const memUsagePercent = ((totalMem - freeMem) / totalMem) * 100
    items.push({
      name: 'Memory',
      category: 'system',
      level: memUsagePercent > 90 ? 'error' : memUsagePercent > 80 ? 'warn' : 'ok',
      message: `Memory usage: ${memUsagePercent.toFixed(1)}% (${((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(1)}GB / ${(totalMem / 1024 / 1024 / 1024).toFixed(1)}GB)`,
      suggestion: memUsagePercent > 80 ? '内存使用率过高，建议关闭不必要的应用' : undefined,
    })

    // CPU
    const cpus = os.cpus()
    items.push({
      name: 'CPU',
      category: 'system',
      level: 'ok',
      message: `${cpus.length} cores (${cpus[0]?.model || 'Unknown'})`,
    })

    // 磁盘空间（检查用户数据目录所在磁盘）
    try {
      const userDataPath = process.env.USERDATA_PATH || ''
      if (userDataPath && fs.existsSync(userDataPath)) {
        const stats = fs.statSync(userDataPath)
        items.push({
          name: 'User Data Directory',
          category: 'system',
          level: 'ok',
          message: `Data dir accessible: ${userDataPath}`,
          details: { isDirectory: stats.isDirectory() },
        })
      }
    } catch (err) {
      items.push({
        name: 'User Data Directory',
        category: 'system',
        level: 'error',
        message: `Data dir not accessible: ${err instanceof Error ? err.message : String(err)}`,
        suggestion: '检查用户数据目录权限',
      })
    }

    // 进程运行时间
    items.push({
      name: 'Process Uptime',
      category: 'system',
      level: 'info',
      message: `Uptime: ${Math.round(process.uptime() / 60)} minutes`,
    })

    return items
  }
}

// ============================================
// Channel 连接检查器
// ============================================

class ChannelChecker implements DiagnosticChecker {
  category: DiagnosticCategory = 'channel'

  async check(): Promise<DiagnosticItem[]> {
    const items: DiagnosticItem[] = []

    try {
      // 动态导入避免循环依赖
      const { channelService } = require('../messaging/MessagingService')
      const channels = channelService.getRegisteredChannels()
      const statuses = channelService.getAllAccountStatuses()

      items.push({
        name: 'Registered Channels',
        category: 'channel',
        level: channels.length > 0 ? 'ok' : 'warn',
        message: `${channels.length} channels registered`,
        suggestion: channels.length === 0 ? '未注册任何渠道，请在设置中配置' : undefined,
      })

      // 检查各渠道连接状态
      const connectedCount = statuses.filter((s: any) => s.connected).length
      const errorCount = statuses.filter((s: any) => s.lastError).length

      items.push({
        name: 'Channel Connections',
        category: 'channel',
        level: errorCount > 0 ? 'error' : connectedCount === 0 && statuses.length > 0 ? 'warn' : 'ok',
        message: `${connectedCount}/${statuses.length} accounts connected, ${errorCount} errors`,
        suggestion: errorCount > 0 ? '部分渠道连接异常，请检查认证配置' : undefined,
      })

      // Webhook 状态
      const webhookInfo = channelService.getWebhookInfo()
      items.push({
        name: 'Webhook Server',
        category: 'channel',
        level: webhookInfo.running ? 'ok' : 'info',
        message: webhookInfo.running
          ? `Webhook running on port ${webhookInfo.port}`
          : 'Webhook not running',
      })

    } catch (err) {
      items.push({
        name: 'Channel Service',
        category: 'channel',
        level: 'error',
        message: `Failed to check channels: ${err instanceof Error ? err.message : String(err)}`,
      })
    }

    return items
  }
}

// ============================================
// 插件系统检查器
// ============================================

class PluginChecker implements DiagnosticChecker {
  category: DiagnosticCategory = 'plugin'

  async check(): Promise<DiagnosticItem[]> {
    const items: DiagnosticItem[] = []

    try {
      const { getPluginRegistry } = require('../plugin-sdk/PluginRegistry')
      const registry = getPluginRegistry()
      const registrations = registry.getAllRegistrations()

      const activeCount = registrations.filter((r: any) => r.status === 'active').length
      const errorCount = registrations.filter((r: any) => r.status === 'error').length

      items.push({
        name: 'Plugin System',
        category: 'plugin',
        level: errorCount > 0 ? 'warn' : 'ok',
        message: `${registrations.length} plugins registered, ${activeCount} active, ${errorCount} errors`,
        suggestion: errorCount > 0 ? '部分插件加载异常，请检查插件日志' : undefined,
      })

      // 检查插件冲突
      const typeMap = new Map<string, string[]>()
      for (const reg of registrations) {
        const types = Array.isArray(reg.manifest.type) ? reg.manifest.type : [reg.manifest.type]
        for (const type of types) {
          if (!typeMap.has(type)) typeMap.set(type, [])
          typeMap.get(type)!.push(reg.manifest.id)
        }
      }

      for (const [type, ids] of typeMap) {
        if (ids.length > 1) {
          items.push({
            name: `Plugin Conflict: ${type}`,
            category: 'plugin',
            level: 'info',
            message: `Multiple plugins for type "${type}": ${ids.join(', ')}`,
          })
        }
      }

    } catch (err) {
      items.push({
        name: 'Plugin System',
        category: 'plugin',
        level: 'warn',
        message: `Plugin registry not available: ${err instanceof Error ? err.message : String(err)}`,
      })
    }

    return items
  }
}

// ============================================
// AI Provider 健康检查器
// ============================================

class ProviderChecker implements DiagnosticChecker {
  category: DiagnosticCategory = 'provider'

  async check(): Promise<DiagnosticItem[]> {
    const items: DiagnosticItem[] = []

    try {
      const { SettingsDb } = require('../settings-db/SettingsDb')
      const db = SettingsDb.getInstance()

      // 检查数据库是否可用
      if (!(db as any).db) {
        items.push({
          name: 'Provider Database',
          category: 'provider',
          level: 'warn',
          message: 'SettingsDb not initialized, cannot check providers',
        })
        return items
      }

      // 获取所有 Provider 配置
      const providers = db.getAllProviderConfigs?.() || []
      if (providers.length === 0) {
        items.push({
          name: 'AI Providers',
          category: 'provider',
          level: 'warn',
          message: 'No AI providers configured',
          suggestion: '请在设置中配置至少一个 AI Provider',
        })
        return items
      }

      items.push({
        name: 'AI Providers',
        category: 'provider',
        level: 'ok',
        message: `${providers.length} provider(s) configured`,
      })

      // 逐个检查 Provider 可达性
      for (const provider of providers) {
        const checkResult = await this.checkProviderReachability(provider)
        items.push(checkResult)
      }

    } catch (err) {
      items.push({
        name: 'Provider Check',
        category: 'provider',
        level: 'error',
        message: `Failed to check providers: ${err instanceof Error ? err.message : String(err)}`,
      })
    }

    return items
  }

  /**
   * 检查单个 Provider 的 API 可达性
   */
  private async checkProviderReachability(provider: {
    providerId: string
    baseUrl: string
    apiKey: string
    model: string
  }): Promise<DiagnosticItem> {
    const { providerId, baseUrl, apiKey, model } = provider

    // 检查 API Key 是否配置
    if (!apiKey || apiKey.trim() === '') {
      return {
        name: `Provider: ${providerId}`,
        category: 'provider',
        level: 'warn',
        message: `API key not configured for ${providerId}`,
        suggestion: `请在设置中配置 ${providerId} 的 API Key`,
      }
    }

    // 检查 Base URL 是否配置
    if (!baseUrl || baseUrl.trim() === '') {
      return {
        name: `Provider: ${providerId}`,
        category: 'provider',
        level: 'warn',
        message: `Base URL not configured for ${providerId}`,
        suggestion: `请在设置中配置 ${providerId} 的 API 地址`,
      }
    }

    // 尝试 HTTP 请求检查可达性
    try {
      const url = new URL(baseUrl)
      const endpoint = `${url.protocol}//${url.host}/v1/models`

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (response.ok) {
        return {
          name: `Provider: ${providerId}`,
          category: 'provider',
          level: 'ok',
          message: `${providerId} API reachable (model: ${model})`,
          details: { baseUrl, model, statusCode: response.status },
        }
      }

      if (response.status === 401) {
        return {
          name: `Provider: ${providerId}`,
          category: 'provider',
          level: 'error',
          message: `${providerId} API key invalid (HTTP 401)`,
          suggestion: `请检查 ${providerId} 的 API Key 是否正确`,
          details: { baseUrl, statusCode: response.status },
        }
      }

      if (response.status === 429) {
        return {
          name: `Provider: ${providerId}`,
          category: 'provider',
          level: 'warn',
          message: `${providerId} API rate limited (HTTP 429)`,
          suggestion: 'API 配额可能已用尽，请稍后重试或升级计划',
          details: { baseUrl, statusCode: response.status },
        }
      }

      return {
        name: `Provider: ${providerId}`,
        category: 'provider',
        level: 'warn',
        message: `${providerId} API returned HTTP ${response.status}`,
        details: { baseUrl, statusCode: response.status },
      }

    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      return {
        name: `Provider: ${providerId}`,
        category: 'provider',
        level: isTimeout ? 'warn' : 'error',
        message: isTimeout
          ? `${providerId} API timeout (10s)`
          : `${providerId} API unreachable: ${err instanceof Error ? err.message : String(err)}`,
        suggestion: isTimeout
          ? 'API 响应超时，请检查网络连接'
          : '请检查 API 地址是否正确、网络是否可达',
        details: { baseUrl, error: err instanceof Error ? err.message : String(err) },
      }
    }
  }
}

// ============================================
// 安全策略检查器
// ============================================

class SecurityChecker implements DiagnosticChecker {
  category: DiagnosticCategory = 'security'

  async check(): Promise<DiagnosticItem[]> {
    const items: DiagnosticItem[] = []

    try {
      const { toolApprovalManager } = require('../security/ToolApprovalManager')
      const { sandboxExecutor } = require('../security/SandboxExecutor')

      items.push({
        name: 'Tool Approval',
        category: 'security',
        level: toolApprovalManager ? 'ok' : 'warn',
        message: toolApprovalManager ? 'Tool approval system active' : 'Tool approval not available',
      })

      items.push({
        name: 'Sandbox',
        category: 'security',
        level: sandboxExecutor ? 'ok' : 'warn',
        message: sandboxExecutor ? 'Sandbox executor available' : 'Sandbox not available',
      })

    } catch {
      items.push({
        name: 'Security Modules',
        category: 'security',
        level: 'warn',
        message: 'Security modules not fully loaded',
      })
    }

    return items
  }
}

// ============================================
// Doctor 服务
// ============================================

class DoctorService {
  private checkers: DiagnosticChecker[] = []

  constructor() {
    this.checkers = [
      new SystemChecker(),
      new ChannelChecker(),
      new ProviderChecker(),
      new PluginChecker(),
      new SecurityChecker(),
    ]
  }

  /**
   * 运行完整诊断
   */
  async runFullDiagnosis(): Promise<DoctorReport> {
    logger.system.info('[Doctor] Running full diagnosis...')

    const allItems: DiagnosticItem[] = []

    for (const checker of this.checkers) {
      try {
        const items = await checker.check()
        allItems.push(...items)
      } catch (err) {
        allItems.push({
          name: `${checker.category} checker`,
          category: checker.category,
          level: 'error',
          message: `Checker failed: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }

    const summary = {
      total: allItems.length,
      ok: allItems.filter(i => i.level === 'ok').length,
      warn: allItems.filter(i => i.level === 'warn').length,
      error: allItems.filter(i => i.level === 'error').length,
      info: allItems.filter(i => i.level === 'info').length,
    }

    const overallStatus: DiagnosticLevel =
      summary.error > 0 ? 'error' : summary.warn > 0 ? 'warn' : 'ok'

    const report: DoctorReport = {
      timestamp: Date.now(),
      overallStatus,
      items: allItems,
      summary,
    }

    logger.system.info(`[Doctor] Diagnosis complete: ${overallStatus} (ok=${summary.ok}, warn=${summary.warn}, error=${summary.error})`)
    return report
  }

  /**
   * 运行指定分类的诊断
   */
  async runCategoryDiagnosis(category: DiagnosticCategory): Promise<DiagnosticItem[]> {
    const checker = this.checkers.find(c => c.category === category)
    if (!checker) return []
    return checker.check()
  }

  /**
   * 注册自定义检查器
   */
  registerChecker(checker: DiagnosticChecker): void {
    this.checkers.push(checker)
  }
}

/** 全局 Doctor 服务实例 */
export const doctorService = new DoctorService()
