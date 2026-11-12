/**
 * 前台窗口滚动位置探针
 *
 * 滚动轨上的滑块要显示「文档滚到哪了」，就必须有真实的滚动位置。桌面端能提供
 * 这个数字的只有系统无障碍接口（Windows 的 UI Automation、macOS 的 AX API），
 * 而两者都是跨进程调用，单次几十到几百毫秒——绝不能在拉帧的主链路上同步等待。
 *
 * 所以这里做成「读缓存 + 后台刷新」：
 * - 每一帧只读缓存，零耗时，帧率完全不受影响
 * - 后台按固定间隔刷新一次，采集成本被限制在后台
 * - 拿不到就返回 null，滑块退回「可拖拽」的静态锚点，绝不编造进度
 */

import { requestScrollPercent as probeWin32 } from './platform/win32PointerBridge'
import { requestScrollPercent as probeDarwin } from './platform/darwinPointerBridge'

/**
 * 后台刷新间隔
 *
 * 400ms 与移动端滚动提速档（120ms 一帧）配合后，滑块最多滞后三帧再叠加过渡动画，
 * 视觉上仍然是连续跟随。再密就会让无障碍接口的调用排满整个后台线程——
 * 它们比截图还贵，且目标程序无响应时会拖到超时。
 */
const PROBE_INTERVAL_MS = 400

/**
 * 缓存有效期
 *
 * 超过这个时长没有成功刷新过，就认为结果已经不代表当前界面（用户可能已经换了
 * 窗口或关了文档）。此时返回 null 让滑块退回静态锚点，而不是继续指着旧位置。
 */
const STALE_MS = 2500

/** 最近一次成功的采样结果；null 表示「确认不可滚动」 */
let cached: number | null = null
let cachedAt = 0
/** 是否有一次采集正在进行；同一时刻只允许一个，避免互相排队 */
let probing = false
let lastProbeAt = 0

/** 按平台分派；未实现的平台直接放弃，滑块走静态锚点 */
function invoke(timeoutMs: number): Promise<number | null> {
  if (process.platform === 'win32') return probeWin32(timeoutMs)
  if (process.platform === 'darwin') return probeDarwin(timeoutMs)
  return Promise.resolve(null)
}

async function refresh(): Promise<void> {
  probing = true
  lastProbeAt = Date.now()
  try {
    const pct = await invoke(600)
    // 采不到也更新 cachedAt：否则「确实不可滚动」会被当成「还没采过」，
    // 每一帧都重新发起一次注定失败的跨进程调用
    cached = pct
    cachedAt = Date.now()
  } catch {
    // 保留旧值，由 STALE_MS 负责让它过期
  } finally {
    probing = false
  }
}

/**
 * 读当前滚动位置（不等待采集）
 *
 * 调用方每次拉帧都会调一次，因此这里必须是同步且廉价的：只读缓存，
 * 顺带在需要时把刷新丢到后台。
 */
export function peekScrollPercent(): number | null {
  const now = Date.now()
  if (!probing && now - lastProbeAt >= PROBE_INTERVAL_MS) void refresh()
  if (now - cachedAt > STALE_MS) return null
  return cached
}

/** 直接取一次最新值；仅用于需要确定的场景，正常拉帧请用 peekScrollPercent */
export async function getScrollPercent(): Promise<number | null> {
  await refresh()
  return cached
}
