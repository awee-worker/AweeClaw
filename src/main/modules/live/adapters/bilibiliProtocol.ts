/**
 * B站弹幕二进制协议工具（开放平台 / 网页模式共用）
 *
 * 协议头（对齐源项目 `blivedm/clients/ws_base.py` 的 `struct.Struct('>I2H2I')`）：
 *
 *   offset  size  field
 *   ------  ----  ----------------------------------------
 *   0       4     pack_len        整包长度（含包头）
 *   4       2     raw_header_size 包头长度（固定 16）
 *   6       2     ver             协议版本（0 明文 / 1 心跳 / 2 zlib / 3 brotli）
 *   8       4     operation       操作码
 *   12      4     seq_id          序列号
 *
 * 关键差异（源项目注释点名过）：网页端已不用 zlib 压缩，但**开放平台仍在用**，
 * 所以两条链路都必须支持 deflate 与 brotli —— 压缩体内又是完整的「包序列」，
 * 必须递归解包，不能只当普通 JSON 处理。
 *
 * @module live/adapters/bilibiliProtocol
 */

import * as zlib from 'zlib'

/** 包头长度（字节） */
export const BILI_HEADER_SIZE = 16

/** 协议版本 */
export const BiliProtoVer = {
  /** 未压缩，体为 JSON */
  NORMAL: 0,
  /** 心跳 */
  HEARTBEAT: 1,
  /** zlib deflate 压缩（开放平台在用） */
  DEFLATE: 2,
  /** brotli 压缩（网页模式在用） */
  BROTLI: 3,
} as const

/** 操作码（只列本模块用得到的） */
export const BiliOperation = {
  HANDSHAKE: 0,
  HANDSHAKE_REPLY: 1,
  HEARTBEAT: 2,
  HEARTBEAT_REPLY: 3,
  /** 业务消息 */
  SEND_MSG: 4,
  SEND_MSG_REPLY: 5,
  /** 认证 */
  AUTH: 7,
  AUTH_REPLY: 8,
} as const

/** 解包后的单个包 */
export interface BilibiliPacket {
  operation: number
  ver: number
  body: Buffer
}

/**
 * 打包一个待发送的包。
 *
 * 与源项目 `_make_packet` 完全一致：`ver = 1`、`seq_id = 1`。
 * 心跳包体固定传 `'{}'`（2 字节，包长 18），与源项目 `json.dumps({})` 的行为一致 ——
 * 不要图省事改成空 Buffer，否则包长与源实现不同，排障时会对不上。
 */
export function packPacket(body: string | Buffer, operation: number): Buffer {
  const bodyBuffer = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body
  const header = Buffer.alloc(BILI_HEADER_SIZE)
  header.writeUInt32BE(BILI_HEADER_SIZE + bodyBuffer.length, 0)
  header.writeUInt16BE(BILI_HEADER_SIZE, 4)
  header.writeUInt16BE(1, 6)
  header.writeUInt32BE(operation, 8)
  header.writeUInt32BE(1, 12)
  return Buffer.concat([header, bodyBuffer])
}

/**
 * 把一条 WS 二进制消息拆成若干包。
 *
 * 一个 WS 帧里可能塞了多个包（源项目 `_parse_ws_message` 的 while 循环即为此）。
 * 遇到非法包头（长度越界）时立刻停止，只丢弃剩余数据而不抛错 ——
 * 半包场景下继续按偏移读只会产生垃圾数据。
 */
export function splitPackets(data: Buffer): BilibiliPacket[] {
  const packets: BilibiliPacket[] = []
  let offset = 0

  while (offset + BILI_HEADER_SIZE <= data.length) {
    const packLen = data.readUInt32BE(offset)
    const headerSize = data.readUInt16BE(offset + 4)
    const ver = data.readUInt16BE(offset + 6)
    const operation = data.readUInt32BE(offset + 8)

    if (packLen < headerSize || offset + packLen > data.length) break

    packets.push({
      operation,
      ver,
      body: data.subarray(offset + headerSize, offset + packLen),
    })
    offset += packLen
  }

  return packets
}

/**
 * 解压包体。
 *
 * @returns 解压后的 Buffer；未压缩或版本未知时返回 null（由调用方决定如何处理）
 */
export function decompressBody(ver: number, body: Buffer): Buffer | null {
  try {
    if (ver === BiliProtoVer.BROTLI) return zlib.brotliDecompressSync(body)
    if (ver === BiliProtoVer.DEFLATE) return zlib.inflateSync(body)
  } catch {
    // 解压失败（脏数据 / 半包）交给调用方记日志，不向上抛
    return null
  }
  return null
}

/**
 * 解析业务包体为命令数组。
 *
 * 两种形态都要兼容：
 * - 网页模式：单条命令对象 `{ cmd, data }`
 * - 开放平台：命令数组 `[{ cmd, data }, ...]`
 */
export function parseCommands(body: Buffer): Array<Record<string, unknown>> {
  if (body.length === 0) return []
  try {
    const parsed: unknown = JSON.parse(body.toString('utf-8'))
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    }
    if (parsed && typeof parsed === 'object') return [parsed as Record<string, unknown>]
  } catch {
    return []
  }
  return []
}

/**
 * 取规范化后的 cmd。
 *
 * B站 2019 年弹幕升级后 cmd 会带参数（`DANMU_MSG:4:0:2:2:2:0`），
 * 源项目同样做了截断处理。
 */
export function normalizeCmd(command: Record<string, unknown>): string {
  const raw = command.cmd
  if (typeof raw !== 'string') return ''
  const pos = raw.indexOf(':')
  return pos === -1 ? raw : raw.slice(0, pos)
}

/** 读取心跳回包中的人气值（前 4 字节，大端） */
export function readPopularity(body: Buffer): number {
  if (body.length < 4) return 0
  return body.readUInt32BE(0)
}

/**
 * 把 ws 的 message 载荷归一化到 Buffer。
 *
 * `ws` 在未设置 `binaryType` 时可能给出 Buffer、ArrayBuffer 或 Buffer[]，
 * 统一收口避免每个适配器各写一遍。
 */
export function toBinaryBuffer(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data) && data.every(Buffer.isBuffer)) return Buffer.concat(data as Buffer[])
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return null
}

/** B站弹幕服务器要求的 User-Agent（对齐源项目 `utils.USER_AGENT`） */
export const BILI_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36'
