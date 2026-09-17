/**
 * 编辑器「行级历史」请求总线
 *
 * 右键菜单（CodeEditorMenu）与历史面板（GitLineHistoryPanel）在不同的组件子树里，
 * 没有父子关系，用一个极小的模块级总线把「查看某行历史」的意图传出去。
 *
 * 面板宿主是 WorkspaceEditor —— 它始终挂载，因此不存在"请求时还没人监听"的丢事件问题，
 * 也就不需要 pending 队列。
 */

export interface GitLineHistoryRequest {
  /** 目标文件绝对路径 */
  filePath: string
  /** 1-based 行号（编辑器语义，与 Monaco 一致） */
  line: number
  /** 请求时间戳（调试 / 去重用） */
  at: number
}

type Listener = (request: GitLineHistoryRequest) => void

const listeners = new Set<Listener>()

/** 请求查看某文件某行的 Git 历史（由编辑器右键菜单调用） */
export function openGitLineHistory(filePath: string, line: number): void {
  if (!filePath) return

  const request: GitLineHistoryRequest = { filePath, line, at: Date.now() }

  for (const listener of listeners) {
    try {
      listener(request)
    } catch {
      /* 单个监听器异常不应影响其他监听器 */
    }
  }
}

/** 订阅历史请求（面板宿主调用），返回取消订阅函数 */
export function subscribeGitLineHistory(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
