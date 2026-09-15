/**
 * VMC 协议骨骼映射器
 *
 * 负责外部骨骼名（VSeeFace、Warudo 等）到 three-vrm 的 normalizedHumanBones 的映射。
 * 支持：
 * - 骨骼名称映射
 * - 表情名称映射
 * - 未映射项日志记录
 *
 * 映射表设计：
 * - 支持多种外部应用的骨骼命名规范
 * - 自动处理大小写差异（PascalCase / camelCase）
 * - 提供默认映射和自定义映射扩展
 *
 * @module vmc/VmcMapper
 */

import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 类型定义
// ============================================

/** 骨骼映射配置 */
export interface BoneMapping {
  /** 外部骨骼名 */
  externalName: string
  /** 内部骨骼名 */
  internalName: string
  /** 是否需要坐标变换 */
  transformRequired?: boolean
}

/** 表情映射配置 */
export interface BlendMapping {
  /** 外部表情名 */
  externalName: string
  /** 内部表情名 */
  internalName: string
  /** 权重缩放因子 */
  weightScale?: number
}

/** 映射结果 */
export interface MappingResult<T> {
  /** 映射后的数据 */
  data: T
  /** 是否成功映射 */
  mapped: boolean
  /** 原始名称 */
  originalName: string
  /** 映射后的名称 */
  mappedName: string
}

// ============================================
// 默认映射表
// ============================================

/**
 * 默认骨骼映射表
 * 
 * 支持 VSeeFace 和 Warudo 的常见骨骼命名规范。
 * 外部骨骼名使用 PascalCase，内部使用 three-vrm 的 normalizedHumanBones。
 */
export const DEFAULT_BONE_MAPPINGS: BoneMapping[] = [
  // 核心骨骼
  { externalName: 'Hips', internalName: 'hips' },
  { externalName: 'Spine', internalName: 'spine' },
  { externalName: 'Chest', internalName: 'chest' },
  { externalName: 'UpperChest', internalName: 'upperChest' },
  { externalName: 'Neck', internalName: 'neck' },
  { externalName: 'Head', internalName: 'head' },
  
  // 左臂
  { externalName: 'LeftShoulder', internalName: 'leftShoulder' },
  { externalName: 'LeftUpperArm', internalName: 'leftUpperArm' },
  { externalName: 'LeftLowerArm', internalName: 'leftLowerArm' },
  { externalName: 'LeftHand', internalName: 'leftHand' },
  
  // 右臂
  { externalName: 'RightShoulder', internalName: 'rightShoulder' },
  { externalName: 'RightUpperArm', internalName: 'rightUpperArm' },
  { externalName: 'RightLowerArm', internalName: 'rightLowerArm' },
  { externalName: 'RightHand', internalName: 'rightHand' },
  
  // 左腿
  { externalName: 'LeftUpperLeg', internalName: 'leftUpperLeg' },
  { externalName: 'LeftLowerLeg', internalName: 'leftLowerLeg' },
  { externalName: 'LeftFoot', internalName: 'leftFoot' },
  { externalName: 'LeftToes', internalName: 'leftToes' },
  
  // 右腿
  { externalName: 'RightUpperLeg', internalName: 'rightUpperLeg' },
  { externalName: 'RightLowerLeg', internalName: 'rightLowerLeg' },
  { externalName: 'RightFoot', internalName: 'rightFoot' },
  { externalName: 'RightToes', internalName: 'rightToes' },
  
  // 左手手指
  { externalName: 'LeftThumbProximal', internalName: 'leftThumbProximal' },
  { externalName: 'LeftThumbIntermediate', internalName: 'leftThumbIntermediate' },
  { externalName: 'LeftThumbDistal', internalName: 'leftThumbDistal' },
  { externalName: 'LeftIndexProximal', internalName: 'leftIndexProximal' },
  { externalName: 'LeftIndexIntermediate', internalName: 'leftIndexIntermediate' },
  { externalName: 'LeftIndexDistal', internalName: 'leftIndexDistal' },
  { externalName: 'LeftMiddleProximal', internalName: 'leftMiddleProximal' },
  { externalName: 'LeftMiddleIntermediate', internalName: 'leftMiddleIntermediate' },
  { externalName: 'LeftMiddleDistal', internalName: 'leftMiddleDistal' },
  { externalName: 'LeftRingProximal', internalName: 'leftRingProximal' },
  { externalName: 'LeftRingIntermediate', internalName: 'leftRingIntermediate' },
  { externalName: 'LeftRingDistal', internalName: 'leftRingDistal' },
  { externalName: 'LeftLittleProximal', internalName: 'leftLittleProximal' },
  { externalName: 'LeftLittleIntermediate', internalName: 'leftLittleIntermediate' },
  { externalName: 'LeftLittleDistal', internalName: 'leftLittleDistal' },
  
  // 右手手指
  { externalName: 'RightThumbProximal', internalName: 'rightThumbProximal' },
  { externalName: 'RightThumbIntermediate', internalName: 'rightThumbIntermediate' },
  { externalName: 'RightThumbDistal', internalName: 'rightThumbDistal' },
  { externalName: 'RightIndexProximal', internalName: 'rightIndexProximal' },
  { externalName: 'RightIndexIntermediate', internalName: 'rightIndexIntermediate' },
  { externalName: 'RightIndexDistal', internalName: 'rightIndexDistal' },
  { externalName: 'RightMiddleProximal', internalName: 'rightMiddleProximal' },
  { externalName: 'RightMiddleIntermediate', internalName: 'rightMiddleIntermediate' },
  { externalName: 'RightMiddleDistal', internalName: 'rightMiddleDistal' },
  { externalName: 'RightRingProximal', internalName: 'rightRingProximal' },
  { externalName: 'RightRingIntermediate', internalName: 'rightRingIntermediate' },
  { externalName: 'RightRingDistal', internalName: 'rightRingDistal' },
  { externalName: 'RightLittleProximal', internalName: 'rightLittleProximal' },
  { externalName: 'RightLittleIntermediate', internalName: 'rightLittleIntermediate' },
  { externalName: 'RightLittleDistal', internalName: 'rightLittleDistal' },
  
  // 眼睛骨骼
  { externalName: 'LeftEye', internalName: 'leftEye' },
  { externalName: 'RightEye', internalName: 'rightEye' },
  
  // 下巴
  { externalName: 'Jaw', internalName: 'jaw' },
]

/**
 * 默认表情映射表
 * 
 * 支持 VSeeFace 和 Warudo 的常见表情命名规范。
 * 权重范围：0-1
 */
export const DEFAULT_BLEND_MAPPINGS: BlendMapping[] = [
  // 基础表情
  { externalName: 'Joy', internalName: 'happy' },
  { externalName: 'Angry', internalName: 'angry' },
  { externalName: 'Sorrow', internalName: 'sad' },
  { externalName: 'Fun', internalName: 'relaxed' },
  { externalName: 'Surprised', internalName: 'surprised' },
  
  // 眼睛表情
  { externalName: 'Blink', internalName: 'blink' },
  { externalName: 'BlinkLeft', internalName: 'blinkLeft' },
  { externalName: 'BlinkRight', internalName: 'blinkRight' },
  { externalName: 'LookUp', internalName: 'lookUp' },
  { externalName: 'LookDown', internalName: 'lookDown' },
  { externalName: 'LookLeft', internalName: 'lookLeft' },
  { externalName: 'LookRight', internalName: 'lookRight' },
  
  // 嘴巴表情
  { externalName: 'A', internalName: 'aa' },
  { externalName: 'I', internalName: 'ih' },
  { externalName: 'U', internalName: 'ou' },
  { externalName: 'E', internalName: 'ee' },
  { externalName: 'O', internalName: 'oh' },
  
  // 其他表情
  { externalName: 'BrowUp', internalName: 'browUp' },
  { externalName: 'BrowDown', internalName: 'browDown' },
  { externalName: 'MouthOpen', internalName: 'mouthOpen' },
  { externalName: 'MouthSmile', internalName: 'mouthSmile' },
]

// ============================================
// 映射器类
// ============================================

class VmcMapper {
  private boneMappings: Map<string, BoneMapping> = new Map()
  private blendMappings: Map<string, BlendMapping> = new Map()
  private unmappedBones: Set<string> = new Set()
  private unmappedBlends: Set<string> = new Set()

  constructor() {
    this.loadDefaultMappings()
  }

  /** 加载默认映射表 */
  private loadDefaultMappings(): void {
    // 加载骨骼映射
    for (const mapping of DEFAULT_BONE_MAPPINGS) {
      this.boneMappings.set(mapping.externalName.toLowerCase(), mapping)
    }

    // 加载表情映射
    for (const mapping of DEFAULT_BLEND_MAPPINGS) {
      this.blendMappings.set(mapping.externalName.toLowerCase(), mapping)
    }

    logger.system.info('[VmcMapper] Default mappings loaded', {
      boneMappings: this.boneMappings.size,
      blendMappings: this.blendMappings.size,
    })
  }

  /** 添加自定义骨骼映射 */
  addBoneMapping(mapping: BoneMapping): void {
    this.boneMappings.set(mapping.externalName.toLowerCase(), mapping)
    logger.system.info('[VmcMapper] Added bone mapping', {
      external: mapping.externalName,
      internal: mapping.internalName,
    })
  }

  /** 添加自定义表情映射 */
  addBlendMapping(mapping: BlendMapping): void {
    this.blendMappings.set(mapping.externalName.toLowerCase(), mapping)
    logger.system.info('[VmcMapper] Added blend mapping', {
      external: mapping.externalName,
      internal: mapping.internalName,
    })
  }

  /** 映射骨骼名称 */
  mapBoneName(externalName: string): string {
    const mapping = this.boneMappings.get(externalName.toLowerCase())
    
    if (mapping) {
      return mapping.internalName
    }

    // 记录未映射的骨骼名
    if (!this.unmappedBones.has(externalName)) {
      this.unmappedBones.add(externalName)
      logger.system.warn('[VmcMapper] Unmapped bone name', { externalName })
    }

    // 返回原始名称（小写形式）
    return externalName.charAt(0).toLowerCase() + externalName.slice(1)
  }

  /** 映射表情名称 */
  mapBlendName(externalName: string): string {
    const mapping = this.blendMappings.get(externalName.toLowerCase())
    
    if (mapping) {
      return mapping.internalName
    }

    // 记录未映射的表情名
    if (!this.unmappedBlends.has(externalName)) {
      this.unmappedBlends.add(externalName)
      logger.system.warn('[VmcMapper] Unmapped blend name', { externalName })
    }

    // 返回原始名称（小写形式）
    return externalName.charAt(0).toLowerCase() + externalName.slice(1)
  }

  /** 映射骨骼数据 */
  mapBoneData(bone: { boneName: string; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } }): MappingResult<typeof bone> {
    const mappedName = this.mapBoneName(bone.boneName)
    const mapped = mappedName !== bone.boneName

    return {
      data: {
        ...bone,
        boneName: mappedName,
      },
      mapped,
      originalName: bone.boneName,
      mappedName,
    }
  }

  /** 映射表情数据 */
  mapBlendData(blend: { blendName: string; weight: number }): MappingResult<typeof blend> {
    const mappedName = this.mapBlendName(blend.blendName)
    const mapped = mappedName !== blend.blendName

    // 查找映射配置，应用权重缩放
    const mapping = this.blendMappings.get(blend.blendName.toLowerCase())
    const weightScale = mapping?.weightScale ?? 1

    return {
      data: {
        blendName: mappedName,
        weight: Math.max(0, Math.min(1, blend.weight * weightScale)),
      },
      mapped,
      originalName: blend.blendName,
      mappedName,
    }
  }

  /** 获取未映射的骨骼名列表 */
  getUnmappedBones(): string[] {
    return Array.from(this.unmappedBones)
  }

  /** 获取未映射的表情名列表 */
  getUnmappedBlends(): string[] {
    return Array.from(this.unmappedBlends)
  }

  /** 清除未映射记录 */
  clearUnmappedRecords(): void {
    this.unmappedBones.clear()
    this.unmappedBlends.clear()
  }

  /** 获取所有骨骼映射 */
  getBoneMappings(): BoneMapping[] {
    return Array.from(this.boneMappings.values())
  }

  /** 获取所有表情映射 */
  getBlendMappings(): BlendMapping[] {
    return Array.from(this.blendMappings.values())
  }

  /** 重置为默认映射 */
  resetToDefaults(): void {
    this.boneMappings.clear()
    this.blendMappings.clear()
    this.unmappedBones.clear()
    this.unmappedBlends.clear()
    this.loadDefaultMappings()
  }
}

// 单例
let instance: VmcMapper | null = null

/** 获取 VmcMapper 单例 */
export function getVmcMapper(): VmcMapper {
  if (!instance) {
    instance = new VmcMapper()
  }
  return instance
}