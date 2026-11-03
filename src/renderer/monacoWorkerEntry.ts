/**
 * Monaco Editor Worker 配置
 * 配置 Monaco 使用 Web Worker 来处理语言服务
 */

import * as monaco from 'monaco-editor'
import { registerMonaco } from './monacoRegistry'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
// Monaco 0.55+ 需要单独导入 TypeScript 语言服务
import {
  typescriptDefaults,
  javascriptDefaults,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
  JsxEmit,
} from 'monaco-editor/esm/vs/language/typescript/monaco.contribution'

// Monaco 内部错误（例如 "InstantiationService has been disposed"）默认只保留 10 帧调用栈，
// 不足以定位触发方；提升到 50 帧便于排查编辑器生命周期问题。
if (typeof Error.stackTraceLimit === 'number' && Error.stackTraceLimit < 50) {
  Error.stackTraceLimit = 50
}

// 配置 Monaco 环境
// 使用 globalThis 替代 self，确保在浏览器和 Worker 环境中都能正常工作
// Monaco 已经定义了 Environment 类型，我们直接使用
globalThis.MonacoEnvironment = {
  getWorker(_: unknown, label: string): Worker {
    if (label === 'json') {
      return new jsonWorker()
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker()
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker()
    }
    return new editorWorker()
  }
}

// 配置 TypeScript/JavaScript 语言服务
// 注意：这些配置会在 monacoTypeService.ts 的 initMonacoTypeService 中被覆盖
// 这里只做基础配置，避免在初始化前出现错误
// 完全禁用内置诊断，因为我们使用外部 LSP 服务
// Monaco 内置的 TS worker 无法正确处理 Electron 的文件路径
typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true, // 也禁用语法检查，避免路径解析错误
  noSuggestionDiagnostics: true,
})

javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true,
  noSuggestionDiagnostics: true,
})

// 开启 eager model sync：model 只有被同步进 ts.worker 才会有补全与悬停，
// 关闭时语言服务对新建 model 一无所知，表现为编辑器「什么都弹不出来」。
// initMonacoTypeService 也会设置为 true，这里保持同一取值，避免初始化顺序差异。
typescriptDefaults.setEagerModelSync(true)
javascriptDefaults.setEagerModelSync(true)

// 配置编译选项
typescriptDefaults.setCompilerOptions({
  target: ScriptTarget.ESNext,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.NodeJs,
  jsx: JsxEmit.React,
  allowNonTsExtensions: true,
  allowJs: true,
  checkJs: false,
  strict: false,
  noEmit: true,
  esModuleInterop: true,
  skipLibCheck: true,
})

javascriptDefaults.setCompilerOptions({
  target: ScriptTarget.ESNext,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.NodeJs,
  jsx: JsxEmit.React,
  allowNonTsExtensions: true,
  allowJs: true,
  checkJs: false,
  noEmit: true,
  esModuleInterop: true,
  skipLibCheck: true,
})

// 登记到注册表：保存 / 版本同步等模块据此判断 Monaco 是否已在内存中，
// 而不必静态 import 本模块（那会让懒加载失效）
registerMonaco(monaco)

export { monaco }
