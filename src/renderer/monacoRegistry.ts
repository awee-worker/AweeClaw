/**
 * Monaco 运行实例注册表
 *
 * Monaco 全量包（含 TS/JSON/CSS/HTML 语言服务入口）体积大、常驻内存高，
 * 只有打开代码编辑器时才需要加载。
 *
 * 保存、版本同步这类模块需要读取「已存在的 Monaco model」，但它们本身不是
 * Monaco 的加载入口。若直接 `import { monaco } from './monacoWorkerEntry'`，
 * 整包就会被静态拉进首屏 bundle —— 依赖链是
 * AweeApp → @hooks(index barrel) → useFileSave / useFileWatcher → monacoWorkerEntry，
 * 于是 bootstrap 里的 requestIdleCallback 懒加载完全失效。
 *
 * 因此这些模块只读取这里的注册表：未加载时返回 null，
 * 与「该文件没有对应的 model」语义完全一致。
 */

export type MonacoApi = typeof import('./monacoWorkerEntry').monaco

let loaded: MonacoApi | null = null

/** 由 monacoWorkerEntry 在模块求值时调用，标记 Monaco 已在内存中 */
export function registerMonaco(api: MonacoApi): void {
  loaded = api
}

/** 获取已加载的 Monaco 实例；未加载（用户还没打开过编辑器）时返回 null */
export function getLoadedMonaco(): MonacoApi | null {
  return loaded
}
