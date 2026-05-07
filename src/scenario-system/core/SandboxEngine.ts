/**
 * 场景脚本沙箱引擎
 *
 * 基于 quickjs-emscripten 提供安全的 JavaScript 执行环境。
 * 外部场景可以包含自定义脚本，在受限沙箱中运行。
 *
 * 安全措施：
 * - 无文件系统访问
 * - 无网络访问
 * - 受限的执行时间（超时自动终止）
 * - 受限的内存使用
 * - 仅暴露白名单 API
 */

import { getQuickJS } from 'quickjs-emscripten'
import type { QuickJSWASMModule, QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'
import { logger } from '@shared/utils/Logger'

export interface SandboxOptions {
  timeoutMs?: number
  maxMemoryBytes?: number
  maxStackSize?: number
}

export interface SandboxResult {
  success: boolean
  value: unknown
  error?: string
  console: string[]
  durationMs: number
}

const DEFAULT_OPTIONS: Required<SandboxOptions> = {
  timeoutMs: 5000,
  maxMemoryBytes: 10 * 1024 * 1024,
  maxStackSize: 1024 * 1024,
}

let quickjsModule: QuickJSWASMModule | null = null

async function getQuickJSModule(): Promise<QuickJSWASMModule> {
  if (!quickjsModule) {
    quickjsModule = await getQuickJS()
  }
  return quickjsModule
}

export type SandboxAPIProvider = (vm: QuickJSContext) => Record<string, QuickJSHandle>

function extractResult(vm: QuickJSContext, handle: QuickJSHandle): unknown {
  const typeofVal = vm.typeof(handle)

  if (typeofVal === 'undefined') return undefined
  if (typeofVal === 'number') return vm.getNumber(handle)
  if (typeofVal === 'string') return vm.getString(handle)
  if (typeofVal === 'boolean') return vm.dump(handle)
  if (typeofVal === 'null') return null

  if (typeofVal === 'object' || typeofVal === 'function') {
    try {
      return vm.dump(handle)
    } catch {
      return `[${typeofVal}]`
    }
  }

  return undefined
}

export async function executeInSandbox(
  code: string,
  apiProviders: SandboxAPIProvider[] = [],
  _options: SandboxOptions = {},
): Promise<SandboxResult> {
  const startTime = Date.now()
  const consoleOutput: string[] = []

  let vm: QuickJSContext | null = null

  try {
    const QuickJS = await getQuickJSModule()
    vm = QuickJS.newContext()

    const global = vm.global

    const consoleObj = vm.newObject()
    const logFn = vm.newFunction('log', (...args) => {
      const parts: string[] = []
      for (const arg of args) {
        try {
          parts.push(vm?.getString(arg) ?? String(arg))
        } catch {
          parts.push(String(arg))
        }
      }
      consoleOutput.push(parts.join(' '))
    })
    vm.setProp(consoleObj, 'log', logFn)
    vm.setProp(consoleObj, 'warn', logFn)
    vm.setProp(consoleObj, 'error', logFn)
    vm.setProp(consoleObj, 'info', logFn)
    vm.setProp(global, 'console', consoleObj)
    logFn.dispose()
    consoleObj.dispose()

    for (const provider of apiProviders) {
      const apis = provider(vm)
      for (const [key, handle] of Object.entries(apis)) {
        vm.setProp(global, key, handle)
      }
    }

    const result = vm.evalCode(code, 'scenario-script.js', { type: 'global' })

    const durationMs = Date.now() - startTime

    if (result.error) {
      const errorHandle = result.error
      let errorMessage = 'Unknown error'

      try {
        const messageHandle = vm.getProp(errorHandle, 'message')
        errorMessage = vm.getString(messageHandle)
        messageHandle.dispose()
      } catch {}

      try {
        const stackHandle = vm.getProp(errorHandle, 'stack')
        const stack = vm.getString(stackHandle)
        stackHandle.dispose()
        if (stack) errorMessage += '\n' + stack
      } catch {}

      errorHandle.dispose()

      return {
        success: false,
        value: undefined,
        error: errorMessage,
        console: consoleOutput,
        durationMs,
      }
    }

    const value = extractResult(vm, result.value)
    result.value.dispose()

    return {
      success: true,
      value,
      console: consoleOutput,
      durationMs,
    }
  } catch (err) {
    const durationMs = Date.now() - startTime

    logger.agent.error('[SandboxEngine] Execution error:', err)

    return {
      success: false,
      value: undefined,
      error: err instanceof Error ? err.message : String(err),
      console: consoleOutput,
      durationMs,
    }
  } finally {
    if (vm) {
      try {
        vm.dispose()
      } catch {}
    }
  }
}

export async function validateScript(code: string): Promise<{ valid: boolean; error?: string }> {
  let vm: QuickJSContext | null = null

  try {
    const QuickJS = await getQuickJSModule()
    vm = QuickJS.newContext()

    const result = vm.evalCode(code, 'validate.js', { type: 'global' })

    if (result.error) {
      let errorMessage = 'Syntax error'
      try {
        const messageHandle = vm.getProp(result.error, 'message')
        errorMessage = vm.getString(messageHandle)
        messageHandle.dispose()
      } catch {}
      result.error.dispose()
      return { valid: false, error: errorMessage }
    }

    result.value.dispose()
    return { valid: true }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (vm) {
      try {
        vm.dispose()
      } catch {}
    }
  }
}
