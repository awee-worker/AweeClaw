/**
 * VMC 协议 OSC 编解码器
 *
 * OSC（Open Sound Control）协议编解码实现，用于 VMC 协议数据传输。
 * 支持 VMC 协议常用的 OSC 消息类型：
 * - /VMC/Ext/OK        [int]                    握手心跳
 * - /VMC/Ext/T         [float]                  时间戳
 * - /VMC/Ext/Root/Pos  [s name][f x][f y][f z][f rx][f ry][f rz][f rw]
 * - /VMC/Ext/Bone/Pos  [s boneName][f x][f y][f z][f rx][f ry][f rz][f rw]
 * - /VMC/Ext/Blend/Val [s blendName][f value]
 * - /VMC/Ext/Blend/Apply
 *
 * @module vmc/VmcCodec
 */

// ============================================
// 类型定义
// ============================================

/** OSC 参数类型 */
export type OscArgType = 'i' | 'f' | 's' | 'b'

/** OSC 参数 */
export interface OscArg {
  type: OscArgType
  value: number | string | Buffer
}

/** OSC 消息 */
export interface OscMessage {
  address: string
  args: OscArg[]
}

/** OSC 包（Bundle） */
export interface OscBundle {
  timeTag: bigint
  packets: (OscMessage | OscBundle)[]
}

/** VMC 骨骼数据 */
export interface VmcBoneData {
  boneName: string
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
}

/** VMC 表情数据 */
export interface VmcBlendData {
  blendName: string
  weight: number
}

/** VMC 帧数据 */
export interface VmcFrameData {
  bones: VmcBoneData[]
  blends: VmcBlendData[]
  timestamp?: number
}

// ============================================
// 编码器
// ============================================

/**
 * 编码 OSC 字符串（4 字节对齐 + null 填充）
 */
function encodeString(str: string): Buffer {
  const bytes = Buffer.from(str, 'utf-8')
  const paddedLength = Math.ceil((bytes.length + 1) / 4) * 4
  const padded = Buffer.alloc(paddedLength, 0)
  bytes.copy(padded)
  return padded
}

/**
 * 编码 OSC 参数
 */
function encodeArg(arg: OscArg): Buffer {
  switch (arg.type) {
    case 'i': {
      const buf = Buffer.alloc(4)
      buf.writeInt32BE(arg.value as number, 0)
      return buf
    }
    case 'f': {
      const buf = Buffer.alloc(4)
      buf.writeFloatBE(arg.value as number, 0)
      return buf
    }
    case 's':
      return encodeString(arg.value as string)
    case 'b': {
      const data = arg.value as Buffer
      const buf = Buffer.alloc(4 + data.length)
      buf.writeUInt32BE(data.length, 0)
      data.copy(buf, 4)
      return buf
    }
    default:
      throw new Error(`Unsupported OSC type: ${arg.type}`)
  }
}

/**
 * 编码 OSC 消息
 */
export function encodeOscMessage(msg: OscMessage): Buffer {
  const addressBuf = encodeString(msg.address)
  
  // 构建类型标签
  let typeTag = ','
  for (const arg of msg.args) {
    typeTag += arg.type
  }
  const typeTagBuf = encodeString(typeTag)
  
  // 编码参数
  const argBufs = msg.args.map(encodeArg)
  
  // 合并所有部分
  const totalLength = addressBuf.length + typeTagBuf.length + argBufs.reduce((sum, buf) => sum + buf.length, 0)
  const result = Buffer.alloc(totalLength)
  
  let offset = 0
  addressBuf.copy(result, offset)
  offset += addressBuf.length
  
  typeTagBuf.copy(result, offset)
  offset += typeTagBuf.length
  
  for (const buf of argBufs) {
    buf.copy(result, offset)
    offset += buf.length
  }
  
  return result
}

/**
 * 编码 OSC Bundle
 */
export function encodeOscBundle(bundle: OscBundle): Buffer {
  // Bundle 头
  const header = encodeString('#bundle')
  
  // 时间标签（8 字节）
  const timeTagBuf = Buffer.alloc(8)
  const seconds = Number(bundle.timeTag >> 32n)
  const fraction = Number(bundle.timeTag & 0xFFFFFFFFn)
  timeTagBuf.writeUInt32BE(seconds, 0)
  timeTagBuf.writeUInt32BE(fraction, 4)
  
  // 编码所有包
  const packetBufs = bundle.packets.map(packet => {
    if ('address' in packet) {
      // OscMessage
      const msgBuf = encodeOscMessage(packet)
      const sizeBuf = Buffer.alloc(4)
      sizeBuf.writeUInt32BE(msgBuf.length, 0)
      return Buffer.concat([sizeBuf, msgBuf])
    } else {
      // OscBundle（递归）
      const bundleBuf = encodeOscBundle(packet)
      const sizeBuf = Buffer.alloc(4)
      sizeBuf.writeUInt32BE(bundleBuf.length, 0)
      return Buffer.concat([sizeBuf, bundleBuf])
    }
  })
  
  // 合并所有部分
  const totalLength = header.length + timeTagBuf.length + packetBufs.reduce((sum, buf) => sum + buf.length, 0)
  const result = Buffer.alloc(totalLength)
  
  let offset = 0
  header.copy(result, offset)
  offset += header.length
  
  timeTagBuf.copy(result, offset)
  offset += timeTagBuf.length
  
  for (const buf of packetBufs) {
    buf.copy(result, offset)
    offset += buf.length
  }
  
  return result
}

// ============================================
// 解码器
// ============================================

/**
 * 解码 OSC 字符串
 */
function decodeString(buf: Buffer, offset: number): { value: string; newOffset: number } {
  const end = buf.indexOf(0, offset)
  if (end === -1) {
    throw new Error('Invalid OSC string: no null terminator')
  }
  const value = buf.toString('utf-8', offset, end)
  const newOffset = Math.ceil((end + 1) / 4) * 4
  return { value, newOffset }
}

/**
 * 解码 OSC 参数
 */
function decodeArg(buf: Buffer, offset: number, type: OscArgType): { value: number | string | Buffer; newOffset: number } {
  switch (type) {
    case 'i': {
      const value = buf.readInt32BE(offset)
      return { value, newOffset: offset + 4 }
    }
    case 'f': {
      const value = buf.readFloatBE(offset)
      return { value, newOffset: offset + 4 }
    }
    case 's': {
      return decodeString(buf, offset)
    }
    case 'b': {
      const length = buf.readUInt32BE(offset)
      const value = buf.slice(offset + 4, offset + 4 + length)
      const newOffset = Math.ceil((offset + 4 + length) / 4) * 4
      return { value, newOffset }
    }
    default:
      throw new Error(`Unsupported OSC type: ${type}`)
  }
}

/**
 * 解码 OSC 消息
 */
export function decodeOscMessage(buf: Buffer, offset: number = 0): { message: OscMessage; newOffset: number } {
  // 解码地址
  const { value: address, newOffset: offset1 } = decodeString(buf, offset)
  
  // 解码类型标签
  const { value: typeTag, newOffset: offset2 } = decodeString(buf, offset1)
  
  // 解码参数
  const args: OscArg[] = []
  let currentOffset = offset2
  
  for (let i = 1; i < typeTag.length; i++) {
    const type = typeTag[i] as OscArgType
    const { value, newOffset } = decodeArg(buf, currentOffset, type)
    args.push({ type, value })
    currentOffset = newOffset
  }
  
  return {
    message: { address, args },
    newOffset: currentOffset,
  }
}

/**
 * 解码 OSC Bundle
 */
export function decodeOscBundle(buf: Buffer, offset: number = 0): { bundle: OscBundle; newOffset: number } {
  // 检查 Bundle 头
  const { value: header, newOffset: offset1 } = decodeString(buf, offset)
  if (header !== '#bundle') {
    throw new Error('Invalid OSC bundle: missing #bundle header')
  }
  
  // 解码时间标签
  const seconds = buf.readUInt32BE(offset1)
  const fraction = buf.readUInt32BE(offset1 + 4)
  const timeTag = (BigInt(seconds) << 32n) | BigInt(fraction)
  let currentOffset = offset1 + 8
  
  // 解码所有包
  const packets: (OscMessage | OscBundle)[] = []
  
  while (currentOffset < buf.length) {
    // 读取包大小
    const packetSize = buf.readUInt32BE(currentOffset)
    currentOffset += 4
    
    // 检查是否是 Bundle
    const packetBuf = buf.slice(currentOffset, currentOffset + packetSize)
    const { value: packetHeader } = decodeString(packetBuf, 0)
    
    if (packetHeader === '#bundle') {
      // 递归解码 Bundle
      const { bundle } = decodeOscBundle(packetBuf, 0)
      packets.push(bundle)
    } else {
      // 解码消息
      const { message } = decodeOscMessage(packetBuf, 0)
      packets.push(message)
    }
    
    currentOffset += packetSize
  }
  
  return {
    bundle: { timeTag, packets },
    newOffset: currentOffset,
  }
}

// ============================================
// VMC 协议辅助函数
// ============================================

/**
 * 创建 VMC 握手心跳消息
 */
export function createHeartbeatMessage(): OscMessage {
  return {
    address: '/VMC/Ext/OK',
    args: [{ type: 'i', value: 1 }],
  }
}

/**
 * 创建 VMC 时间戳消息
 */
export function createTimestampMessage(timestamp: number): OscMessage {
  return {
    address: '/VMC/Ext/T',
    args: [{ type: 'f', value: timestamp }],
  }
}

/**
 * 创建 VMC 骨骼位置消息
 */
export function createBoneMessage(bone: VmcBoneData): OscMessage {
  return {
    address: '/VMC/Ext/Bone/Pos',
    args: [
      { type: 's', value: bone.boneName },
      { type: 'f', value: bone.position.x },
      { type: 'f', value: bone.position.y },
      { type: 'f', value: bone.position.z },
      { type: 'f', value: bone.rotation.x },
      { type: 'f', value: bone.rotation.y },
      { type: 'f', value: bone.rotation.z },
      { type: 'f', value: bone.rotation.w },
    ],
  }
}

/**
 * 创建 VMC 根骨骼位置消息
 */
export function createRootBoneMessage(bone: VmcBoneData): OscMessage {
  return {
    address: '/VMC/Ext/Root/Pos',
    args: [
      { type: 's', value: bone.boneName },
      { type: 'f', value: bone.position.x },
      { type: 'f', value: bone.position.y },
      { type: 'f', value: bone.position.z },
      { type: 'f', value: bone.rotation.x },
      { type: 'f', value: bone.rotation.y },
      { type: 'f', value: bone.rotation.z },
      { type: 'f', value: bone.rotation.w },
    ],
  }
}

/**
 * 创建 VMC 表情值消息
 */
export function createBlendMessage(blend: VmcBlendData): OscMessage {
  return {
    address: '/VMC/Ext/Blend/Val',
    args: [
      { type: 's', value: blend.blendName },
      { type: 'f', value: Math.max(0, Math.min(1, blend.weight)) },
    ],
  }
}

/**
 * 创建 VMC 表情应用消息
 */
export function createBlendApplyMessage(): OscMessage {
  return {
    address: '/VMC/Ext/Blend/Apply',
    args: [],
  }
}

/**
 * 解析 VMC 骨骼消息
 */
export function parseBoneMessage(msg: OscMessage): VmcBoneData | null {
  if (msg.address !== '/VMC/Ext/Bone/Pos' && msg.address !== '/VMC/Ext/Root/Pos') {
    return null
  }
  
  if (msg.args.length < 8) {
    return null
  }
  
  return {
    boneName: msg.args[0].value as string,
    position: {
      x: msg.args[1].value as number,
      y: msg.args[2].value as number,
      z: msg.args[3].value as number,
    },
    rotation: {
      x: msg.args[4].value as number,
      y: msg.args[5].value as number,
      z: msg.args[6].value as number,
      w: msg.args[7].value as number,
    },
  }
}

/**
 * 解析 VMC 表情消息
 */
export function parseBlendMessage(msg: OscMessage): VmcBlendData | null {
  if (msg.address !== '/VMC/Ext/Blend/Val') {
    return null
  }
  
  if (msg.args.length < 2) {
    return null
  }
  
  return {
    blendName: msg.args[0].value as string,
    weight: msg.args[1].value as number,
  }
}