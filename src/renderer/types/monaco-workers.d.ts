/**
 * Monaco Editor Worker 类型声明
 *
 * 为 AweeClaw 客户端中通过 Vite `?worker` 后缀导入的 Monaco Editor 各语言 Worker
 * 提供 TypeScript 类型支持，并补充 TypeScript 语言服务的扩展 API 类型。
 *
 * 涵盖：
 * - 编辑器主 Worker
 * - JSON / CSS / HTML / TypeScript 语言 Worker
 * - TypeScript 语言服务配置（编译选项、诊断、模块解析等）
 *
 * @module AweeClawMonacoWorkers
 */

declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  /** Monaco 编辑器主 Worker 工厂 */
  const EditorWorkerFactory: new () => Worker
  export default EditorWorkerFactory
}

declare module 'monaco-editor/esm/vs/language/json/json.worker?worker' {
  /** Monaco JSON 语言 Worker 工厂 */
  const JsonWorkerFactory: new () => Worker
  export default JsonWorkerFactory
}

declare module 'monaco-editor/esm/vs/language/css/css.worker?worker' {
  /** Monaco CSS 语言 Worker 工厂 */
  const CssWorkerFactory: new () => Worker
  export default CssWorkerFactory
}

declare module 'monaco-editor/esm/vs/language/html/html.worker?worker' {
  /** Monaco HTML 语言 Worker 工厂 */
  const HtmlWorkerFactory: new () => Worker
  export default HtmlWorkerFactory
}

declare module 'monaco-editor/esm/vs/language/typescript/ts.worker?worker' {
  /** Monaco TypeScript 语言 Worker 工厂 */
  const TypeScriptWorkerFactory: new () => Worker
  export default TypeScriptWorkerFactory
}

declare module 'monaco-editor/esm/vs/language/typescript/monaco.contribution' {
  import type { IDisposable } from 'monaco-editor'

  /** TypeScript / JavaScript 语言服务默认配置 */
  export interface LanguageServiceDefaults {
    /** 设置编译器选项 */
    setCompilerOptions(options: unknown): void
    /** 设置诊断选项 */
    setDiagnosticsOptions(options: unknown): void
    /** 是否启用模型同步 */
    setEagerModelSync(value: boolean): void
    /** 添加额外库（用于自动补全） */
    addExtraLib(content: string, filePath?: string): IDisposable
  }

  /** TypeScript 语言服务默认配置实例 */
  export const typescriptDefaults: LanguageServiceDefaults
  /** JavaScript 语言服务默认配置实例 */
  export const javascriptDefaults: LanguageServiceDefaults

  /** 脚本目标版本枚举 */
  export const ScriptTarget: {
    readonly ESNext: number
    readonly ES2020: number
    readonly ES2019: number
    readonly ES2018: number
    readonly ES2017: number
    readonly ES2016: number
    readonly ES2015: number
    readonly ES5: number
    readonly ES3: number
  }

  /** 模块生成方式枚举 */
  export const ModuleKind: {
    readonly ESNext: number
    readonly ES2020: number
    readonly ES2015: number
    readonly CommonJS: number
    readonly AMD: number
    readonly UMD: number
    readonly System: number
    readonly None: number
  }

  /** 模块解析策略枚举 */
  export const ModuleResolutionKind: {
    readonly NodeJs: number
    readonly Classic: number
  }

  /** JSX 编译输出方式枚举 */
  export const JsxEmit: {
    readonly React: number
    readonly ReactNative: number
    readonly Preserve: number
    readonly None: number
  }
}
