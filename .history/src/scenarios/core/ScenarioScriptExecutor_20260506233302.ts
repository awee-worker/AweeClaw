/**
 * 场景脚本执行器
 *
 * 管理场景脚本的加载、缓存和执行。
 * 场景脚本在 QuickJS 沙箱中运行，通过受控 API 与宿主交互。
 *
 * 支持的脚本类型：
 * - 生命周期钩子：onActivate、onDeactivate、onHealthCheck
 * - 脚本化工具：通过脚本实现的自定义工具
 */

import { executeInSandbox, validateScript, type SandboxAPIProvider, type SandboxResult } from './SandboxEngine'
import { createContextAPI, createCoreAPI, type ScenarioSandboxContext } from './SandboxAPI'
import type { DeclarativeScripts, DeclarativeScriptTool } from '@shared/types/scenario-declarative'
import type { ScenarioModuleContext, ScenarioHealthCheck, ScenarioToolDefinition } from '@shared/types/scenario-arch'
import type { ToolDefinition, ToolExecutionResult, ToolExecutionContext, ToolExecutor, ToolPropertySchema } from '@/shared/types'
import { logger } from '@shared/utils/Logger'

export class ScenarioScriptExecutor {
  private scenarioId: string
  private version: string
  private files: Record<string, string>
  private scripts: DeclarativeScripts | undefined
  private scriptCache = new Map<string, string>()

  constructor(
    scenarioId: string,
    version: string,
    files: Record<string, string>,
    scripts: DeclarativeScripts | undefined,
  ) {
    this.scenarioId = scenarioId
    this.version = version
    this.files = files
    this.scripts = scripts
  }

  private getScriptCode(source: string | undefined, fileKey: string): string | null {
    if (source) return source

    const cached = this.scriptCache.get(fileKey)
    if (cached) return cached

    const fileContent = this.files[fileKey]
    if (fileContent) {
      this.scriptCache.set(fileKey, fileContent)
      return fileContent
    }

    return null
  }

  private createSandboxContext(moduleContext: ScenarioModuleContext): ScenarioSandboxContext {
    return {
      scenarioId: this.scenarioId,
      version: this.version,
      workspacePath: null,
      getState: (key: string) => {
        try {
          const raw = localStorage.getItem(`scenario-state:${this.scenarioId}:${key}`)
          return raw ? JSON.parse(raw) : undefined
        } catch {
          return undefined
        }
      },
      setState: (key: string, value: unknown) => {
        try {
          localStorage.setItem(`scenario-state:${this.scenarioId}:${key}`, JSON.stringify(value))
        } catch {}
      },
      querySql: async (query: string, connectionId?: string) => {
        logger.agent.info(`[ScriptExecutor] SQL query from script: ${query.substring(0, 100)}`)
        return { pending: true }
      },
      log: (level: string, message: string) => {
        logger.agent.info(`[Script:${this.scenarioId}] [${level}] ${message}`)
      },
    }
  }

  private buildAPIProviders(sandboxCtx: ScenarioSandboxContext): SandboxAPIProvider[] {
    return [
      createCoreAPI(),
      createContextAPI(sandboxCtx),
    ]
  }

  async executeOnActivate(moduleContext: ScenarioModuleContext): Promise<void> {
    if (!this.scripts) return

    const code = this.getScriptCode(this.scripts.onActivate, this.scripts.onActivateFile || 'scripts/onActivate.js')
    if (!code) return

    const sandboxCtx = this.createSandboxContext(moduleContext)
    const result = await executeInSandbox(code, this.buildAPIProviders(sandboxCtx), {
      timeoutMs: 10000,
    })

    if (!result.success) {
      logger.agent.error(`[ScriptExecutor] onActivate failed for "${this.scenarioId}": ${result.error}`)
    } else {
      logger.agent.info(`[ScriptExecutor] onActivate completed for "${this.scenarioId}" in ${result.durationMs}ms`)
    }
  }

  async executeOnDeactivate(moduleContext: ScenarioModuleContext): Promise<void> {
    if (!this.scripts) return

    const code = this.getScriptCode(this.scripts.onDeactivate, this.scripts.onDeactivateFile || 'scripts/onDeactivate.js')
    if (!code) return

    const sandboxCtx = this.createSandboxContext(moduleContext)
    const result = await executeInSandbox(code, this.buildAPIProviders(sandboxCtx), {
      timeoutMs: 10000,
    })

    if (!result.success) {
      logger.agent.error(`[ScriptExecutor] onDeactivate failed for "${this.scenarioId}": ${result.error}`)
    }
  }

  async executeOnHealthCheck(): Promise<ScenarioHealthCheck[]> {
    if (!this.scripts) {
      return [{ name: 'scripts', status: 'healthy', message: 'No scripts configured' }]
    }

    const code = this.getScriptCode(this.scripts.onHealthCheck, this.scripts.onHealthCheckFile || 'scripts/onHealthCheck.js')
    if (!code) {
      return [{ name: 'scripts', status: 'healthy', message: 'No health check script' }]
    }

    const sandboxCtx = this.createSandboxContext({
      scenarioId: this.scenarioId,
      version: this.version,
      getLogger: () => logger,
      getHealthReporter: () => ({ reportCheck: () => {} }),
      publishData: () => {},
    } as unknown as ScenarioModuleContext)

    const result = await executeInSandbox(code, this.buildAPIProviders(sandboxCtx), {
      timeoutMs: 5000,
    })

    if (!result.success) {
      return [{ name: 'scripts', status: 'degraded', message: `Health check error: ${result.error}` }]
    }

    const checks: ScenarioHealthCheck[] = [
      { name: 'scripts', status: 'healthy', message: 'Scripts running normally' },
    ]

    if (result.value && typeof result.value === 'object') {
      const scriptResult = result.value as Record<string, unknown>
      if (scriptResult.status && typeof scriptResult.status === 'string') {
        checks.push({
          name: 'script-health',
          status: scriptResult.status as ScenarioHealthCheck['status'],
          message: String(scriptResult.message || 'Script health check completed'),
        })
      }
    }

    return checks
  }

  getScriptToolDefinitions(): ScenarioToolDefinition[] {
    if (!this.scripts?.tools) return []

    const tools: ScenarioToolDefinition[] = []

    for (const scriptTool of this.scripts.tools) {
      const code = this.getScriptCode(undefined, scriptTool.scriptFile)
      if (!code) continue

      const parameters: ToolDefinition['parameters'] = {
        type: 'object',
        properties: {},
        required: [],
      }

      for (const [key, param] of Object.entries(scriptTool.parameters)) {
        const prop: ToolPropertySchema = {
          type: param.type,
          description: param.description,
        }
        if (param.enum) prop.enum = param.enum
        parameters.properties![key] = prop
        if (param.required) {
          (parameters.required as string[]).push(key)
        }
      }

      const executor = this.createScriptToolExecutor(scriptTool)

      tools.push({
        name: scriptTool.name,
        definition: {
          name: scriptTool.name,
          description: scriptTool.description,
          parameters,
        },
        executor,
      })
    }

    return tools
  }

  private createScriptToolExecutor(scriptTool: DeclarativeScriptTool): ToolExecutor {
    return async (args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const code = this.getScriptCode(undefined, scriptTool.scriptFile)
      if (!code) {
        return { success: false, result: '', error: `Script file not found: ${scriptTool.scriptFile}` }
      }

      const wrappedCode = `
        (function() {
          const __args = ${JSON.stringify(args)};
          const __toolDef = ${code};
          if (typeof __toolDef === 'function') {
            return __toolDef(__args);
          }
          if (typeof __toolDef === 'object' && typeof __toolDef.execute === 'function') {
            return __toolDef.execute(__args);
          }
          return { error: 'Invalid tool script: must export a function or object with execute method' };
        })()
      `

      const sandboxCtx: ScenarioSandboxContext = {
        scenarioId: this.scenarioId,
        version: this.version,
        workspacePath: null,
        getState: (key: string) => {
          try {
            const raw = localStorage.getItem(`scenario-state:${this.scenarioId}:${key}`)
            return raw ? JSON.parse(raw) : undefined
          } catch {
            return undefined
          }
        },
        setState: (key: string, value: unknown) => {
          try {
            localStorage.setItem(`scenario-state:${this.scenarioId}:${key}`, JSON.stringify(value))
          } catch {}
        },
        querySql: async () => ({ pending: true }),
        log: (level: string, message: string) => {
          logger.agent.info(`[ScriptTool:${scriptTool.name}] [${level}] ${message}`)
        },
      }

      const result = await executeInSandbox(wrappedCode, this.buildAPIProviders(sandboxCtx), {
        timeoutMs: 15000,
      })

      if (!result.success) {
        return { success: false, result: '', error: result.error || 'Script execution failed' }
      }

      const output = result.value
      if (typeof output === 'object' && output !== null) {
        const obj = output as Record<string, unknown>
        if (obj.error) {
          return { success: false, result: '', error: String(obj.error) }
        }
        return {
          success: true,
          result: typeof obj.result === 'string' ? obj.result : JSON.stringify(output, null, 2),
        }
      }

      return {
        success: true,
        result: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
      }
    }
  }

  async validateAllScripts(): Promise<{ valid: boolean; errors: Array<{ file: string; error: string }> }> {
    const errors: Array<{ file: string; error: string }> = []

    if (!this.scripts) return { valid: true, errors: [] }

    const scriptsToValidate: Array<{ file: string; code: string }> = []

    if (this.scripts.onActivateFile) {
      const code = this.getScriptCode(this.scripts.onActivate, this.scripts.onActivateFile)
      if (code) scriptsToValidate.push({ file: this.scripts.onActivateFile, code })
    }
    if (this.scripts.onDeactivateFile) {
      const code = this.getScriptCode(this.scripts.onDeactivate, this.scripts.onDeactivateFile)
      if (code) scriptsToValidate.push({ file: this.scripts.onDeactivateFile, code })
    }
    if (this.scripts.onHealthCheckFile) {
      const code = this.getScriptCode(this.scripts.onHealthCheck, this.scripts.onHealthCheckFile)
      if (code) scriptsToValidate.push({ file: this.scripts.onHealthCheckFile, code })
    }
    if (this.scripts.tools) {
      for (const tool of this.scripts.tools) {
        const code = this.getScriptCode(undefined, tool.scriptFile)
        if (code) scriptsToValidate.push({ file: tool.scriptFile, code })
      }
    }

    for (const { file, code } of scriptsToValidate) {
      const validation = await validateScript(code)
      if (!validation.valid) {
        errors.push({ file, error: validation.error || 'Unknown syntax error' })
      }
    }

    return { valid: errors.length === 0, errors }
  }
}
