/**
 * ScenarioTestFramework - 场景测试验证体系
 *
 * 提供场景模块的自动化测试和验证能力：
 * - 接口合规性检查：验证场景模块是否正确实现所有必需接口
 * - 依赖完整性检查：验证场景声明的依赖是否可满足
 * - 工具定义验证：验证工具定义的参数 schema 是否合法
 * - 生命周期测试：模拟 activate/deactivate 流程，确保无异常
 * - 兼容性测试：验证场景组合是否正常协同工作
 * - 数据交互测试：验证场景间数据总线通信是否正常
 */

import type {
  ScenarioModule,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
} from '@shared/types/scenario-arch'
import { scenarioLoader } from './ScenarioLoader'
import { scenarioDataBus } from './ScenarioDataBus'
import { logger } from '@shared/utils/Logger'

export interface ScenarioTestResult {
  scenarioId: string
  passed: boolean
  checks: ScenarioTestCheck[]
  duration: number
}

export interface ScenarioTestCheck {
  name: string
  passed: boolean
  message?: string
  severity: 'critical' | 'warning' | 'info'
}

class ScenarioTestFrameworkClass {
  testModule(module: ScenarioModule): ScenarioTestResult {
    const startTime = Date.now()
    const checks: ScenarioTestCheck[] = []

    this.checkRequiredFields(module, checks)
    this.checkManifest(module, checks)
    this.checkPlugin(module, checks)
    this.checkTools(module, checks)
    this.checkLifecycle(module, checks)
    this.checkDependencies(module, checks)

    const passed = checks.every(c => c.passed || c.severity !== 'critical')
    const duration = Date.now() - startTime

    return {
      scenarioId: module.id,
      passed,
      checks,
      duration,
    }
  }

  async testModuleAsync(module: ScenarioModule): Promise<ScenarioTestResult> {
    const syncResult = this.testModule(module)

    const asyncChecks: ScenarioTestCheck[] = []
    await this.checkLifecycleAsync(module, asyncChecks)

    syncResult.checks.push(...asyncChecks)
    syncResult.passed = syncResult.checks.every(c => c.passed || c.severity !== 'critical')
    return syncResult
  }

  testCompatibility(modules: ScenarioModule[]): ScenarioTestResult[] {
    const results: ScenarioTestResult[] = []

    for (const module of modules) {
      results.push(this.testModule(module))
    }

    this.checkCrossScenarioConflicts(modules, results)

    return results
  }

  testDataBus(): ScenarioTestCheck[] {
    const checks: ScenarioTestCheck[] = []

    const testScenarioId = '__test__'
    let received = false

    const unsub = scenarioDataBus.subscribe(
      testScenarioId,
      'test-message',
      () => { received = true }
    )

    scenarioDataBus.publish(testScenarioId, 'test-message', { test: true })

    checks.push({
      name: 'data-bus:pub-sub',
      passed: received,
      message: received ? 'Pub/sub works correctly' : 'Pub/sub failed: message not received',
      severity: 'critical',
    })

    scenarioDataBus.setSharedData(testScenarioId, 'test-key', 'test-value')
    const sharedValue = scenarioDataBus.getSharedData('test-key')
    checks.push({
      name: 'data-bus:shared-data',
      passed: sharedValue === 'test-value',
      message: sharedValue === 'test-value' ? 'Shared data works correctly' : 'Shared data failed',
      severity: 'critical',
    })

    scenarioDataBus.setSharedData(testScenarioId, 'readonly-key', 'readonly-value', true)
    scenarioDataBus.setSharedData('__other__', 'readonly-key', 'should-not-write')
    const readonlyValue = scenarioDataBus.getSharedData('readonly-key')
    checks.push({
      name: 'data-bus:readonly-protection',
      passed: readonlyValue === 'readonly-value',
      message: readonlyValue === 'readonly-value' ? 'Read-only protection works' : 'Read-only protection failed',
      severity: 'warning',
    })

    unsub()
    scenarioDataBus.cleanupScenario(testScenarioId)

    return checks
  }

  private checkRequiredFields(module: ScenarioModule, checks: ScenarioTestCheck[]): void {
    checks.push({
      name: 'required:id',
      passed: !!module.id && typeof module.id === 'string' && module.id.length > 0,
      message: !module.id ? 'Module id is required' : undefined,
      severity: 'critical',
    })

    checks.push({
      name: 'required:version',
      passed: !!module.version && typeof module.version === 'string' && /^\d+\.\d+\.\d+/.test(module.version),
      message: !module.version ? 'Module version must follow semver (e.g., 1.0.0)' : undefined,
      severity: 'critical',
    })

    checks.push({
      name: 'required:getManifest',
      passed: typeof module.getManifest === 'function',
      message: typeof module.getManifest !== 'function' ? 'getManifest() is required' : undefined,
      severity: 'critical',
    })

    checks.push({
      name: 'required:getPlugin',
      passed: typeof module.getPlugin === 'function',
      message: typeof module.getPlugin !== 'function' ? 'getPlugin() is required' : undefined,
      severity: 'critical',
    })
  }

  private checkManifest(module: ScenarioModule, checks: ScenarioTestCheck[]): void {
    let manifest: ScenarioManifest | undefined
    try {
      manifest = module.getManifest()
    } catch (err) {
      checks.push({
        name: 'manifest:callable',
        passed: false,
        message: `getManifest() threw: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'critical',
      })
      return
    }

    checks.push({
      name: 'manifest:id-match',
      passed: manifest.id === module.id,
      message: manifest.id !== module.id ? `Manifest id "${manifest.id}" doesn't match module id "${module.id}"` : undefined,
      severity: 'critical',
    })

    checks.push({
      name: 'manifest:version-match',
      passed: manifest.version === module.version,
      message: manifest.version !== module.version ? `Manifest version "${manifest.version}" doesn't match module version "${module.version}"` : undefined,
      severity: 'critical',
    })

    const requiredManifestFields = ['id', 'version', 'name', 'description', 'author', 'icon', 'category', 'entryPoint']
    for (const field of requiredManifestFields) {
      const value = (manifest as unknown as Record<string, unknown>)[field]
      checks.push({
        name: `manifest:field-${field}`,
        passed: !!value,
        message: !value ? `Manifest field "${field}" is required` : undefined,
        severity: 'critical',
      })
    }

    if (manifest.dependencies && manifest.dependencies.length > 0) {
      for (const dep of manifest.dependencies) {
        checks.push({
          name: `manifest:dep-${dep.id}`,
          passed: !!dep.id && typeof dep.id === 'string',
          message: !dep.id ? `Dependency id is required` : undefined,
          severity: dep.required !== false ? 'critical' : 'warning',
        })
      }
    }
  }

  private checkPlugin(module: ScenarioModule, checks: ScenarioTestCheck[]): void {
    let plugin
    try {
      plugin = module.getPlugin()
    } catch (err) {
      checks.push({
        name: 'plugin:callable',
        passed: false,
        message: `getPlugin() threw: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'critical',
      })
      return
    }

    const requiredPluginFields = ['id', 'name', 'version', 'identity', 'capabilities', 'ui', 'dataSources']
    for (const field of requiredPluginFields) {
      const value = (plugin as unknown as Record<string, unknown>)[field]
      checks.push({
        name: `plugin:field-${field}`,
        passed: !!value,
        message: !value ? `Plugin field "${field}" is required` : undefined,
        severity: field === 'id' || field === 'version' ? 'critical' : 'warning',
      })
    }

    if (plugin.id !== module.id) {
      checks.push({
        name: 'plugin:id-match',
        passed: false,
        message: `Plugin id "${plugin.id}" doesn't match module id "${module.id}"`,
        severity: 'critical',
      })
    }
  }

  private checkTools(module: ScenarioModule, checks: ScenarioTestCheck[]): void {
    if (!module.getTools) {
      checks.push({
        name: 'tools:optional',
        passed: true,
        message: 'No tools defined (optional)',
        severity: 'info',
      })
      return
    }

    let tools
    try {
      tools = module.getTools()
    } catch (err) {
      checks.push({
        name: 'tools:callable',
        passed: false,
        message: `getTools() threw: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'critical',
      })
      return
    }

    if (!Array.isArray(tools)) {
      checks.push({
        name: 'tools:array',
        passed: false,
        message: 'getTools() must return an array',
        severity: 'critical',
      })
      return
    }

    checks.push({
      name: 'tools:count',
      passed: tools.length > 0,
      message: tools.length === 0 ? 'No tools defined' : `${tools.length} tools defined`,
      severity: 'info',
    })

    for (const tool of tools) {
      checks.push({
        name: `tools:${tool.name}:name`,
        passed: !!tool.name && typeof tool.name === 'string',
        message: !tool.name ? 'Tool name is required' : undefined,
        severity: 'critical',
      })

      checks.push({
        name: `tools:${tool.name}:definition`,
        passed: !!tool.definition && typeof tool.definition === 'object',
        message: !tool.definition ? `Tool "${tool.name}" missing definition` : undefined,
        severity: 'critical',
      })

      checks.push({
        name: `tools:${tool.name}:executor`,
        passed: !!tool.executor && typeof tool.executor === 'function',
        message: !tool.executor ? `Tool "${tool.name}" missing executor` : undefined,
        severity: 'critical',
      })

      if (tool.definition?.parameters) {
        checks.push({
          name: `tools:${tool.name}:params-schema`,
          passed: tool.definition.parameters.type === 'object',
          message: tool.definition.parameters.type !== 'object' ? `Tool "${tool.name}" parameters must be type "object"` : undefined,
          severity: 'warning',
        })
      }
    }
  }

  private checkLifecycle(module: ScenarioModule, checks: ScenarioTestCheck[]): void {
    if (module.onActivate) {
      checks.push({
        name: 'lifecycle:onActivate-type',
        passed: typeof module.onActivate === 'function',
        severity: 'critical',
      })
    }

    if (module.onDeactivate) {
      checks.push({
        name: 'lifecycle:onDeactivate-type',
        passed: typeof module.onDeactivate === 'function',
        severity: 'critical',
      })
    }

    if (module.onHealthCheck) {
      checks.push({
        name: 'lifecycle:onHealthCheck-type',
        passed: typeof module.onHealthCheck === 'function',
        severity: 'warning',
      })
    }
  }

  private async checkLifecycleAsync(module: ScenarioModule, checks: ScenarioTestCheck[]): Promise<void> {
    if (!module.onActivate) return

    try {
      const mockContext = this.createMockContext(module.id)
      await module.onActivate(mockContext)
      checks.push({
        name: 'lifecycle:onActivate-execution',
        passed: true,
        message: 'onActivate executed without errors',
        severity: 'critical',
      })

      if (module.onDeactivate) {
        await module.onDeactivate(mockContext)
        checks.push({
          name: 'lifecycle:onDeactivate-execution',
          passed: true,
          message: 'onDeactivate executed without errors',
          severity: 'critical',
        })
      }
    } catch (err) {
      checks.push({
        name: 'lifecycle:onActivate-execution',
        passed: false,
        message: `Lifecycle hook threw: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'critical',
      })
    }
  }

  private checkDependencies(module: ScenarioModule, checks: ScenarioTestCheck[]): void {
    const deps = module.getDependencies?.()
    if (!deps || deps.length === 0) return

    for (const dep of deps) {
      const isAvailable = scenarioLoader.has(dep.id)
      checks.push({
        name: `dependency:${dep.id}`,
        passed: isAvailable || dep.required === false,
        message: !isAvailable && dep.required !== false
          ? `Required dependency "${dep.id}" is not registered`
          : !isAvailable
            ? `Optional dependency "${dep.id}" is not registered`
            : `Dependency "${dep.id}" is available`,
        severity: dep.required !== false ? 'critical' : 'warning',
      })
    }
  }

  private checkCrossScenarioConflicts(modules: ScenarioModule[], results: ScenarioTestResult[]): void {
    const toolNameMap = new Map<string, string[]>()

    for (const module of modules) {
      const tools = module.getTools?.() || []
      for (const tool of tools) {
        const owners = toolNameMap.get(tool.name) || []
        owners.push(module.id)
        toolNameMap.set(tool.name, owners)
      }
    }

    for (const [toolName, owners] of toolNameMap) {
      if (owners.length > 1) {
        for (const ownerId of owners) {
          const result = results.find(r => r.scenarioId === ownerId)
          if (result) {
            result.checks.push({
              name: `conflict:tool-${toolName}`,
              passed: false,
              message: `Tool "${toolName}" is defined in multiple scenarios: ${owners.join(', ')}`,
              severity: 'warning',
            })
          }
        }
      }
    }
  }

  private createMockContext(scenarioId: string): import('@shared/types/scenario-arch').ScenarioModuleContext {
    return {
      scenarioId,
      workspacePath: null,
      version: '0.0.0-test',
      registerTools: () => {},
      unregisterTools: () => {},
      registerIpcHandlers: () => {},
      unregisterIpcHandlers: () => {},
      publishData: () => {},
      subscribeData: () => () => {},
      setSharedData: () => {},
      getSharedData: () => undefined,
      getLogger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      }),
      getHealthReporter: () => ({
        reportCheck: () => {},
        reportError: () => {},
      }),
    }
  }
}

export const scenarioTestFramework = new ScenarioTestFrameworkClass()
