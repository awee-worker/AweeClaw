/**
 * 麦克风授权（渲染层统一入口）
 *
 * 语音输入、语音对话、会议纪要等所有需要采集音频的入口，都必须先经过这里，
 * 而不是直接调 getUserMedia。原因是渲染进程拿到的失败信息不足以区分两种情况：
 *
 * - not-determined：系统还没问过用户，此时可以弹授权框 —— 用户点一下就能用
 * - denied / restricted：用户在系统层拒绝过，系统不会再弹任何界面，
 *   必须引导用户去「系统设置 → 隐私与安全性 → 麦克风」手动打开
 *
 * 旧实现直接在 getUserMedia 的 catch 里弹一句 "Microphone permission denied"，
 * 用户既不知道是哪个开关、也没有任何可点的入口，表现为「点了语音按钮没反应」。
 */

import { toast } from '@components/foundation/NotificationProvider'
import { useStore } from '@store'

/** 麦克风授权状态（与主进程返回值一致） */
export type MicAccessStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'
  | 'unsupported'

interface MicAccessPayload {
  status: MicAccessStatus
  granted: boolean
  platform: string
}

/** 引导卡片的去重键：同一次拒绝只弹一张，不随点击次数堆积 */
const GUIDE_DEDUPE_KEY = 'mic-permission-guide'

function getBridge() {
  return typeof window !== 'undefined' ? window.electronAPI?.mediaPermission : undefined
}

/** 当前界面语言 */
function isZh(): boolean {
  try {
    return useStore.getState().language === 'zh'
  } catch {
    return true
  }
}

/**
 * 查询麦克风授权状态（只读，不会弹任何系统界面）
 *
 * 拿不到主进程桥接时返回 granted —— 例如浏览器调试环境，权限交给
 * getUserMedia 自行处理，不要让这里的假设挡住正常流程。
 */
export async function getMicAccessStatus(): Promise<MicAccessStatus> {
  const bridge = getBridge()
  if (!bridge) return 'granted'
  try {
    const res = await bridge.getMicStatus()
    return res?.data?.status ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 请求麦克风授权（仅 not-determined 时系统才会真正弹框） */
async function requestMicAccess(): Promise<MicAccessPayload> {
  const bridge = getBridge()
  if (!bridge) return { status: 'granted', granted: true, platform: 'unknown' }
  try {
    const res = await bridge.requestMic()
    const data = res?.data
    return {
      status: data?.status ?? 'unknown',
      granted: data?.granted ?? false,
      platform: data?.platform ?? 'unknown',
    }
  } catch {
    return { status: 'unknown', granted: false, platform: 'unknown' }
  }
}

/** 打开系统麦克风隐私设置页 */
export async function openMicSettings(): Promise<boolean> {
  const bridge = getBridge()
  if (!bridge) return false
  try {
    const res = await bridge.openMicSettings()
    return res?.data?.opened ?? false
  } catch {
    return false
  }
}

/**
 * 展示麦克风授权引导卡片
 *
 * 卡片不自动消失，用户点「打开系统设置」后去系统里改；关闭卡片表示放弃本次语音。
 */
export function showMicPermissionGuide(status: MicAccessStatus = 'denied'): void {
  const zh = isZh()
  const isWin = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)
  const systemPath = isWin
    ? zh
      ? '「设置 → 隐私和安全性 → 麦克风」'
      : '"Settings → Privacy & security → Microphone"'
    : zh
      ? '「系统设置 → 隐私与安全性 → 麦克风」'
      : '"System Settings → Privacy & Security → Microphone"'

  const detail =
    status === 'restricted'
      ? zh
        ? '当前系统策略或家长控制限制了麦克风，无法录音。请在设备管理或屏幕使用时间中解除限制后再试。'
        : 'Microphone access is restricted by system policy or Screen Time. Remove the restriction and try again.'
      : zh
        ? `系统尚未允许本应用使用麦克风，录音与语音对话都无法进行。请到 ${systemPath} 中勾选本应用，然后返回重试；若列表中找不到本应用，请先更新到最新版本。`
        : `This app is not allowed to use the microphone, so dictation and voice chat cannot record. Allow it in ${systemPath}, then come back and retry. If this app is not listed there, update to the latest version first.`

  const canOpen = typeof window !== 'undefined' && !!getBridge()

  toast.card({
    type: 'warning',
    title: zh ? '无法使用麦克风' : 'Microphone unavailable',
    message: detail,
    dedupeKey: GUIDE_DEDUPE_KEY,
    source: zh ? '语音' : 'Voice',
    actions: canOpen
      ? [
          {
            id: 'open-settings',
            label: zh ? '打开系统设置' : 'Open settings',
            style: 'primary',
            onClick: () => {
              void openMicSettings().then((opened) => {
                if (!opened) {
                  toast.warning(
                    zh
                      ? `请手动前往 ${systemPath} 授权麦克风`
                      : `Please allow the microphone manually in ${systemPath}`,
                  )
                }
              })
            },
          },
        ]
      : undefined,
  })
}

/**
 * 确保麦克风可用，供所有录音入口在 getUserMedia 之前调用。
 *
 * @returns true 可以继续录音；false 表示已给出引导，调用方应中止本次录音
 */
export async function ensureMicAccess(): Promise<boolean> {
  const status = await getMicAccessStatus()

  if (status === 'granted' || status === 'unsupported' || status === 'unknown') {
    // 无从查询或系统已授权：交给 getUserMedia，真正的失败在 catch 里再兜底
    return true
  }

  if (status === 'not-determined') {
    const res = await requestMicAccess()
    if (res.granted || res.status === 'granted') return true
    showMicPermissionGuide(res.status)
    return false
  }

  // denied / restricted：系统不会再弹框，只能引导去设置
  showMicPermissionGuide(status)
  return false
}

/**
 * 判断 getUserMedia 的异常是否属于权限问题
 *
 * 用户可能在 ensureMicAccess 之后、真正采集之前刚好把开关关掉，
 * 所以 catch 里仍需识别一次，避免只丢一句原始英文错误。
 */
export function isMicPermissionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.name === 'NotAllowedError' ||
    err.name === 'SecurityError' ||
    /permission|denied|not\s*allowed/i.test(err.message)
  )
}
