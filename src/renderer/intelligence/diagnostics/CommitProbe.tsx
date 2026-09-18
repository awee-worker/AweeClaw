/**
 * React 提交探针
 *
 * 把 `<Profiler>` 的提交耗时写进性能追踪计数器，用来回答两个此前只能靠猜的问题：
 *
 * 1. 一次提交实际花了多久。累计提交耗时若远小于同期的长任务总量，说明主线程
 *    的时间并不在 React 的提交阶段里，继续削减提交次数只会改善观感、不会显著
 *    降低占用 —— 这时该转向分配与 GC。
 * 2. 贵在哪个子树。嵌套探针把「整份消息列表」与「单条助手消息内容」分开记账，
 *    两者的差值就是列表外壳（虚拟滚动容器、条目包装）的成本。
 *
 * ── 为什么开发与生产走两条路 ──
 *
 * `<Profiler>` 的 onRender 只在带 profiler 的构建里存在：正式构建的
 * react-dom 把整段提交计时连同回调一起编译掉了（`react-dom.production.min.js`
 * 里既没有 actualDuration 也没有 getCommitTime），因此打包版本里挂多少层
 * Profiler 都是死埋点 —— 实测一份 214 秒的采样里 react.* 计数器全程为空，
 * 而同期流式提交每秒十余次。
 *
 * 所以生产构建改用「帧窗口」计价：共享帧循环在执行业务任务前打点，本探针在
 * layout effect 里把「提交结束」与它相减。layout effect 与 DOM 变更同步发生，
 * 量到的是同一帧内本子树渲染加提交的耗时，不需要 React 的 profiler 支持。
 *
 * 两条路的读数含义一致（都是从帧开始到本子树提交结束），但都不等于「本子树
 * 独占的耗时」：探针是嵌套的，内层量到的时间已被外层包含。要看的是它们的
 * 比值与走势，不是相加。
 *
 * ── 为什么可以留在生产代码里 ──
 *
 * 回调里只做几次整数累加，而 perfTrace.bump 在未开启追踪时一次布尔判断即返回。
 *
 * @module intelligence/diagnostics/CommitProbe
 */

import { Profiler, useCallback, useLayoutEffect } from 'react'
import type { ProfilerOnRenderCallback, ReactNode } from 'react'
import * as perfTrace from './perfTraceReporter'
import { PERF_TRACE_COUNTERS } from '@shared/protocols/perfTraceProtocol'

/** 是否为带 profiler 的开发构建：只有它提供 onRender */
const HAS_PROFILER_CALLBACK = import.meta.env.DEV

/** 探针作用域，每个作用域单独记账 */
export type CommitScope = 'messages' | 'assistant-content'

interface ScopeCounters {
  /** 该作用域的累计提交耗时计数器键 */
  ms: string
  /**
   * 是否兼任全局账本。
   *
   * 探针是嵌套的，同一份提交时间会被内外两层各记一次；若两层都往全局
   * 账本上累加，总计就会被放大成两倍。只让最外层记账，其余作用域仅保留
   * 自己的子树耗时，两支数据才可比。
   */
  primary: boolean
}

const SCOPE_COUNTERS: Record<CommitScope, ScopeCounters> = {
  messages: { ms: PERF_TRACE_COUNTERS.reactMessagesCommitMs, primary: true },
  'assistant-content': { ms: PERF_TRACE_COUNTERS.reactAssistantCommitMs, primary: false },
}

export interface CommitProbeProps {
  scope: CommitScope
  children: ReactNode
}

/**
 * 提交探针
 *
 * 用法上与 `<Profiler>` 完全一致，只是把采集结果导向性能追踪计数器，
 * 而不是交给调用方在 onRender 里自己处理。
 */
export function CommitProbe({ scope, children }: CommitProbeProps) {
  const counters = SCOPE_COUNTERS[scope]

  /**
   * 生产路径：以帧窗口起点为基准量本次提交。
   *
   * 无依赖数组，因此每次渲染都会登记一次；配合 layout effect 的同步时机，
   * 量的就是「提交完成」的那一刻。不在帧窗口内（例如由用户交互触发的提交）
   * 直接跳过：那些提交与流式帧成本无关，混进来只会抬高读数。
   */
  useLayoutEffect(() => {
    if (HAS_PROFILER_CALLBACK) return

    const start = perfTrace.currentFrameWindowStart()
    if (start === null) return

    const cost = performance.now() - start
    perfTrace.bump(counters.ms, cost)
    if (!counters.primary) return
    perfTrace.bump(PERF_TRACE_COUNTERS.reactCommits)
    perfTrace.bump(PERF_TRACE_COUNTERS.reactCommitMs, cost)
  })

  const onRender = useCallback<ProfilerOnRenderCallback>(
    (_id, _phase, actualDuration, baseDuration) => {
      perfTrace.bump(counters.ms, actualDuration)
      if (!counters.primary) return
      perfTrace.bump(PERF_TRACE_COUNTERS.reactCommits)
      perfTrace.bump(PERF_TRACE_COUNTERS.reactCommitMs, actualDuration)
      perfTrace.bump(PERF_TRACE_COUNTERS.reactBaseMs, baseDuration)
    },
    [counters],
  )

  // 生产构建下 Profiler 的回调不会被调用，直接渲染子树，省掉一层无用的元素
  if (!HAS_PROFILER_CALLBACK) return <>{children}</>

  return (
    <Profiler id={scope} onRender={onRender}>
      {children}
    </Profiler>
  )
}
