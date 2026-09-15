/**
 * VTS 音频旁路 — 把 TTS 合成结果同时喂给 VTS 口型链路
 *
 * 为什么需要「旁路」而不是在播放链路里加钩子：
 *   TTS 的产出点分散在 `voiceApi.textToSpeech`（自动朗读 / 语音对话 / 伴侣窗口都会
 *   走到它），但**播放**点分散在三处且形态各异（AudioContext、HTMLAudioElement、
 *   PCM 流）。挂在播放点意味着要改三处、且流式场景拿不到完整音频体。
 *   挂在唯一的**产出点**上，一处接入覆盖全部场景。
 *
 * 设计约束：
 *   1. **绝不阻塞 TTS 主链路** —— 全程 fire-and-forget，任何异常都只记 debug 日志
 *   2. **未连接时零开销** —— `vtsReady` 由 useVtsSync 依据主进程状态维护，
 *      未连接时连 `arrayBuffer()` 都不做（大音频的解包也是成本）
 *   3. **不做重试** —— 一段音频丢了就丢了，重试只会让口型与声音错位
 *
 * @module services/vtsAudioTap
 */

import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'

/** VTS 是否处于「可接收音频」状态（由 useVtsSync 维护） */
let vtsReady = false

/**
 * 更新 VTS 可用状态。
 *
 * @param ready 主进程报告已连接且已通过鉴权时为 true
 */
export function setVtsAudioReady(ready: boolean): void {
  vtsReady = ready
}

/** 当前是否会把音频转发给 VTS */
export function isVtsAudioReady(): boolean {
  return vtsReady
}

/**
 * 把一段 TTS 音频转发给 VTS 做口型分析（旁路，失败静默）。
 *
 * 载荷通过 structured clone 传 ArrayBuffer：不额外转 base64（会膨胀 33%），
 * 也不复制成 Uint8Array（多一次全量拷贝）。
 *
 * @param blob TTS 返回的音频
 */
export function emitVtsAudio(blob: Blob | null | undefined): void {
  if (!vtsReady || !blob || blob.size === 0) return

  // 记录调用瞬间的状态：arrayBuffer() 是异步的，期间用户可能已经断开连接
  const size = blob.size

  void blob
    .arrayBuffer()
    .then(buffer => {
      // 解包期间连接断了 → 直接丢弃，避免往已关闭的链路里灌音频
      if (!vtsReady) return
      return api.vts.pushAudio(buffer, blob.type || undefined)
    })
    .then(res => {
      if (res && !res.success) {
        logger.system.debug('[VtsAudioTap] 音频未被 VTS 采纳：', res.error)
      }
    })
    .catch(err => {
      // 转码失败 / IPC 异常都不该影响 TTS 播放，仅记录便于排障
      logger.system.debug(`[VtsAudioTap] 转发音频失败（${size} bytes）：`, err)
    })
}
