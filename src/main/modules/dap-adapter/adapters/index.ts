/**
 * 调试适配器注册表
 *
 * 设计理念：
 * - 注册器模式：统一注册、查询适配器
 * - 工厂函数：每个适配器独立工厂，便于维护
 * - 懒加载：适配器描述符按需生成
 * - 类型安全：完整 TypeScript 类型
 * - 可扩展：新增适配器只需注册，无需修改核心代码
 */

import type {
  DebugAdapterInfo,
  DebugAdapterDescriptor,
  DebugConfig,
} from '../providerTypes'
import { pythonManager } from '../../python-runtime'

/** 适配器工厂函数 */
type AdapterDescriptorFactory = (
  config: DebugConfig,
) => Promise<DebugAdapterDescriptor>

/** 适配器构建器入参 */
interface AdapterBuilder {
  type: string
  label: string
  languages: string[]
  getDescriptor: AdapterDescriptorFactory
  configurationSnippets: DebugAdapterInfo['configurationSnippets']
}

// =================== 适配器工厂 ===================

/** Node.js 适配器工厂 */
function createNodeAdapter(): AdapterBuilder {
  return {
    type: 'node',
    label: 'Node.js',
    languages: ['javascript', 'typescript'],
    async getDescriptor(config: DebugConfig): Promise<DebugAdapterDescriptor> {
      return {
        type: 'server',
        port: config.port || 9229,
        host: config.host || '127.0.0.1',
      }
    },
    configurationSnippets: [
      {
        label: 'Node.js: Launch Program',
        description: 'Launch a Node.js program in debug mode',
        body: {
          type: 'node',
          name: 'Launch Program',
          request: 'launch',
          program: '${file}',
          cwd: '${workspaceFolder}',
          stopOnEntry: false,
        },
      },
      {
        label: 'Node.js: Attach',
        description: 'Attach to a running Node.js process',
        body: {
          type: 'node',
          name: 'Attach to Process',
          request: 'attach',
          port: 9229,
          host: 'localhost',
        },
      },
      {
        label: 'Node.js: Launch via npm',
        description: 'Launch a Node.js program via npm script',
        body: {
          type: 'node',
          name: 'Launch via npm',
          request: 'launch',
          runtimeExecutable: 'npm',
          runtimeArgs: ['run-script', 'debug'],
          cwd: '${workspaceFolder}',
        },
      },
    ],
  }
}

/** Python 适配器工厂 */
function createPythonAdapter(): AdapterBuilder {
  return {
    type: 'python',
    label: 'Python',
    languages: ['python'],
    async getDescriptor(
      _config: DebugConfig,
    ): Promise<DebugAdapterDescriptor> {
      return {
        type: 'executable',
        command: pythonManager.getPythonPath() || 'python',
        args: ['-m', 'debugpy.adapter'],
      }
    },
    configurationSnippets: [
      {
        label: 'Python: Current File',
        description: 'Debug the currently open Python file',
        body: {
          type: 'python',
          name: 'Python: Current File',
          request: 'launch',
          program: '${file}',
          cwd: '${workspaceFolder}',
          console: 'integratedTerminal',
        },
      },
      {
        label: 'Python: Attach',
        description: 'Attach to a running Python process',
        body: {
          type: 'python',
          name: 'Python: Attach',
          request: 'attach',
          port: 5678,
          host: 'localhost',
        },
      },
    ],
  }
}

/** Go 适配器工厂 */
function createGoAdapter(): AdapterBuilder {
  return {
    type: 'go',
    label: 'Go',
    languages: ['go'],
    async getDescriptor(
      _config: DebugConfig,
    ): Promise<DebugAdapterDescriptor> {
      return {
        type: 'executable',
        command: 'dlv',
        args: ['dap'],
      }
    },
    configurationSnippets: [
      {
        label: 'Go: Launch Package',
        description: 'Debug the Go package in the current directory',
        body: {
          type: 'go',
          name: 'Launch Package',
          request: 'launch',
          mode: 'auto',
          program: '${workspaceFolder}',
        },
      },
      {
        label: 'Go: Launch File',
        description: 'Debug a single Go file',
        body: {
          type: 'go',
          name: 'Launch File',
          request: 'launch',
          mode: 'auto',
          program: '${file}',
        },
      },
      {
        label: 'Go: Attach',
        description: 'Attach to a running Go process',
        body: {
          type: 'go',
          name: 'Attach to Process',
          request: 'attach',
          mode: 'local',
          processId: 0,
        },
      },
    ],
  }
}

/** LLDB 适配器工厂（Rust/C/C++） */
function createLldbAdapter(): AdapterBuilder {
  return {
    type: 'lldb',
    label: 'LLDB (Rust/C/C++)',
    languages: ['rust', 'c', 'cpp'],
    async getDescriptor(
      _config: DebugConfig,
    ): Promise<DebugAdapterDescriptor> {
      return {
        type: 'executable',
        command: 'codelldb',
        args: ['--port', '0'],
      }
    },
    configurationSnippets: [
      {
        label: 'LLDB: Launch',
        description: 'Launch a program with LLDB',
        body: {
          type: 'lldb',
          name: 'LLDB: Launch',
          request: 'launch',
          program:
            '${workspaceFolder}/target/debug/${workspaceFolderBasename}',
          cwd: '${workspaceFolder}',
        },
      },
    ],
  }
}

// =================== 适配器注册表 ===================

/**
 * 调试适配器注册表
 *
 * 使用注册器模式管理所有调试适配器：
 * - 支持动态注册
 * - 支持按类型查询
 * - 支持按语言查询
 */
class DebugAdapterRegistry {
  private readonly adapters = new Map<string, DebugAdapterInfo>()
  private readonly languageToType = new Map<string, string>()

  /**
   * 注册适配器
   *
   * @param builder 适配器构建器
   */
  register(builder: AdapterBuilder): void {
    if (this.adapters.has(builder.type)) {
      throw new Error(`调试适配器类型 "${builder.type}" 已注册`)
    }

    const info: DebugAdapterInfo = {
      type: builder.type,
      label: builder.label,
      languages: builder.languages,
      getDescriptor: builder.getDescriptor,
      configurationSnippets: builder.configurationSnippets,
    }

    this.adapters.set(builder.type, info)

    // 建立语言到类型的映射
    for (const lang of builder.languages) {
      if (this.languageToType.has(lang)) {
        throw new Error(
          `语言 "${lang}" 已绑定到适配器 "${this.languageToType.get(lang)}"`,
        )
      }
      this.languageToType.set(lang, builder.type)
    }
  }

  /**
   * 获取适配器信息
   *
   * @param type 适配器类型
   * @returns 适配器信息
   */
  getAdapterInfo(type: string): DebugAdapterInfo | undefined {
    return this.adapters.get(type)
  }

  /**
   * 获取语言对应的适配器
   *
   * @param languageId 语言 ID
   * @returns 适配器信息
   */
  getAdapterForLanguage(languageId: string): DebugAdapterInfo | undefined {
    const type = this.languageToType.get(languageId)
    if (!type) return undefined
    return this.adapters.get(type)
  }

  /**
   * 获取所有适配器
   *
   * @returns 适配器列表
   */
  getAllAdapters(): DebugAdapterInfo[] {
    return Array.from(this.adapters.values())
  }

  /**
   * 获取所有配置代码片段
   *
   * @returns 配置片段列表
   */
  getAllConfigSnippets(): Array<{
    type: string
    snippets: DebugAdapterInfo['configurationSnippets']
  }> {
    return this.getAllAdapters().map((a) => ({
      type: a.type,
      snippets: a.configurationSnippets,
    }))
  }
}

// =================== 导出单例 ===================

/** 调试适配器注册表单例 */
export const adapterRegistry = new DebugAdapterRegistry()

// 注册内置适配器
adapterRegistry.register(createNodeAdapter())
adapterRegistry.register(createPythonAdapter())
adapterRegistry.register(createGoAdapter())
adapterRegistry.register(createLldbAdapter())

// =================== 兼容性导出 ===================

/** 内置调试适配器（兼容旧代码） */
export const builtinAdapters: DebugAdapterInfo[] = adapterRegistry.getAllAdapters()

/**
 * 获取调试适配器信息
 *
 * @param type 适配器类型
 * @returns 适配器信息
 */
export function getAdapterInfo(type: string): DebugAdapterInfo | undefined {
  return adapterRegistry.getAdapterInfo(type)
}

/**
 * 获取语言对应的调试适配器
 *
 * @param languageId 语言 ID
 * @returns 适配器信息
 */
export function getAdapterForLanguage(
  languageId: string,
): DebugAdapterInfo | undefined {
  return adapterRegistry.getAdapterForLanguage(languageId)
}

/**
 * 获取所有配置代码片段
 *
 * @returns 配置片段列表
 */
export function getAllConfigSnippets(): Array<{
  type: string
  snippets: DebugAdapterInfo['configurationSnippets']
}> {
  return adapterRegistry.getAllConfigSnippets()
}
