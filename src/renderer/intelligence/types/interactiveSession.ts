/**
 * 交互式内容类型（用于 ask_user 工具）
 */

/** 选项 */
export interface InteractiveOption {
  id: string
  label: string
  icon?: string
  description?: string
}

/**
 * 「继续执行剩余任务」卡片的清单载荷
 *
 * 用于 AI 收尾时把「这一轮没做完的事」结构化地固定下来，
 * 让用户一键续做，而不必自己复制清单再发给 AI。
 */
export interface ContinuationPayload {
  /** 一句话说明还剩什么没做完（可省略） */
  summary?: string
  /** 未完成的任务清单，按建议的执行顺序排列 */
  remaining: string[]
}

/** 交互式选项内容 */
export interface InteractiveContent {
  type: 'interactive'
  question: string
  options: InteractiveOption[]
  multiSelect?: boolean
  selectedIds?: string[]
  /**
   * 卡片形态
   *
   * - generic（默认缺省）：普通选项卡片（ask_user），点击即把选项文案回传给模型
   * - continue_task：继续任务卡片，展示未完成清单并提供一个「继续执行」入口。
   *   来源有二：AI 主动调用 offer_continuation；或系统在存在未完成待办时
   *   确定性渲染（见 ContinuationBar），后者不依赖模型自觉调用。
   */
  kind?: 'generic' | 'continue_task'
  /** kind='continue_task' 时携带的清单载荷 */
  continuation?: ContinuationPayload
}
