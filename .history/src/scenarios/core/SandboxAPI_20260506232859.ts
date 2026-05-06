/**
 * 场景脚本沙箱 API
 *
 * 定义暴露给场景脚本的受控 API 集合。
 * 场景脚本在 QuickJS 沙箱中运行，只能通过这些 API 与宿主交互。
 *
 * API 分层：
 * - core: 基础工具（JSON、日期、数学等，QuickJS 内置）
 * - data: 数据处理（SQL 查询、数据转换）
 * - storage: 场景状态持久化（键值存储）
 * - context: 场景上下文信息（场景 ID、版本等）
 */

import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'
import type { SandboxAPIProvider } from './SandboxEngine'

export interface ScenarioSandboxContext {
  scenarioId: string
  version: string
  workspacePath: string | null
  getState: (key: string) => unknown
  setState: (key: string, value: unknown) => void
  querySql: (query: string, connectionId?: string) => Promise<unknown>
  log: (level: string, message: string) => void
}

export function createContextAPI(ctx: ScenarioSandboxContext): SandboxAPIProvider {
  return (vm: QuickJSContext): Record<string, QuickJSHandle> => {
    const apis: Record<string, QuickJSHandle> = {}

    const contextObj = vm.newObject()
    vm.setProp(contextObj, 'scenarioId', vm.newString(ctx.scenarioId))
    vm.setProp(contextObj, 'version', vm.newString(ctx.version))
    vm.setProp(contextObj, 'workspacePath', vm.newString(ctx.workspacePath || ''))
    apis.context = contextObj

    const storageObj = vm.newObject()

    const getStateFn = vm.newFunction('getState', (keyHandle) => {
      const key = vm.getString(keyHandle)
      const value = ctx.getState(key)
      if (value === undefined) return vm.undefined
      try {
        const jsonStr = JSON.stringify(value)
        const parsed = vm.evalCode(`(${jsonStr})`, 'storage-get.js', { type: 'global' })
        if (!parsed.error) return parsed.value
        return vm.newString(jsonStr)
      } catch {
        return vm.newString(String(value))
      }
    })
    vm.setProp(storageObj, 'getState', getStateFn)
    getStateFn.dispose()

    const setStateFn = vm.newFunction('setState', (keyHandle, valueHandle) => {
      const key = vm.getString(keyHandle)
      try {
        const value = vm.dump(valueHandle)
        ctx.setState(key, value)
      } catch {
        ctx.setState(key, vm.getString(valueHandle))
      }
    })
    vm.setProp(storageObj, 'setState', setStateFn)
    setStateFn.dispose()

    apis.storage = storageObj

    const dbObj = vm.newObject()

    const queryFn = vm.newFunction('query', (sqlHandle, connHandle) => {
      const sql = vm.getString(sqlHandle)
      const connectionId = connHandle ? vm.getString(connHandle) : 'default'

      ctx.log('info', `[SandboxDB] Query: ${sql.substring(0, 100)}`)

      try {
        ctx.querySql(sql, connectionId).catch(() => {})
      } catch {}

      return vm.newString(JSON.stringify({ pending: true, message: 'Async query initiated' }))
    })
    vm.setProp(dbObj, 'query', queryFn)
    queryFn.dispose()

    apis.db = dbObj

    return apis
  }
}

export function createCoreAPI(): SandboxAPIProvider {
  return (vm: QuickJSContext): Record<string, QuickJSHandle> => {
    const apis: Record<string, QuickJSHandle> = {}

    const envObj = vm.newObject()
    vm.setProp(envObj, 'timestamp', vm.newNumber(Date.now()))

    const nowFn = vm.newFunction('now', () => {
      return vm.newNumber(Date.now())
    })
    vm.setProp(envObj, 'now', nowFn)
    nowFn.dispose()

    apis.env = envObj

    return apis
  }
}
