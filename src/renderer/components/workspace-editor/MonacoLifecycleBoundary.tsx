/**
 * Monaco 生命周期错误边界
 *
 * 背景（monaco 0.55.1 + @monaco-editor/react 4.7.0）：
 * 1. CodeEditorWidget / DiffEditorWidget 在构造时会 createChild() 出一个子
 *    InstantiationService 并 _register 到自身（codeEditorWidget.js），
 *    因此该子服务随 editor.dispose() 一同销毁；
 * 2. @monaco-editor/react 的卸载清理会 dispose editor，但不会把内部 editor ref 置空，
 *    其 updateOptions / setModel / setModelLanguage 等 update effect 只判空、不判 disposure；
 * 3. 一旦这些调用在 editor 已 dispose 后仍落地一次，monaco 内部会走
 *    _applyOptions → _createView() / _attachModel → this._instantiationService.createInstance(...)，
 *    而该 child service 已销毁，于是抛出 "InstantiationService has been disposed"。
 *
 * 这类错误属于「已销毁实例收到迟到调用」，是无害残留：不重建、不向上抛，
 * 静默忽略并记录完整堆栈，避免整个编辑器区域被 React 卸载。
 * 非生命周期类错误会原样抛回上层 ErrorBoundary，不吞真实缺陷。
 */
import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import { logger } from '@toolkit/LogEngine'

/** 已销毁实例被再次使用时的特征信息 */
const LATE_LIFECYCLE_PATTERNS = [
  'InstantiationService has been disposed',
  'Model is disposed',
  'TextModel got disposed',
  'is disposed and cannot be used',
  'Cannot read properties of null',
  'Object has been disposed',
]

function isLateLifecycleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return LATE_LIFECYCLE_PATTERNS.some(pattern => message.includes(pattern))
}

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  /** 自愈重建次数，用于给子树换上新的 key */
  retry: number
}

const MAX_AUTO_RETRY = 2

export class MonacoLifecycleBoundary extends Component<Props, State> {
  state: State = { error: null, retry: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 非生命周期错误：交回上层边界处理（React 会把 componentDidCatch 中抛出的错误冒泡给最近的父边界）
    if (!isLateLifecycleError(error)) {
      throw error
    }

    logger.system.warn(
      `[MonacoLifecycleBoundary] 捕获到编辑器生命周期残留调用（无害，已忽略）: ${error.message}` +
      `\nstack:\n${error.stack ?? '(no stack)'}` +
      `\ncomponentStack:${info.componentStack ?? '(no component stack)'}`
    )

    if (this.state.retry < MAX_AUTO_RETRY) {
      // 子树已被 React 卸载，下一帧换 key 重建即可恢复
      setTimeout(() => {
        this.setState(prev => ({ retry: prev.retry + 1, error: null }))
      }, 0)
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-text-muted select-none">
          编辑器正在恢复…
        </div>
      )
    }

    // Fragment + key：不额外引入 DOM 层，避免影响 Monaco 的高度计算
    return <Fragment key={this.state.retry}>{this.props.children}</Fragment>
  }
}
