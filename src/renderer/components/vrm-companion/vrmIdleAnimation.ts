/**
 * vrmIdleAnimation — VRM 待机动作系统（移植自 example/super-ai-browser/static/js/vrm.js）
 *
 * 提供四件事：
 * 1. applyNaturalPose —— 把模型默认的 T-Pose 掰成自然站姿（手臂下垂 + 手指微曲）
 * 2. createIdleClip   —— 程序化待机动画：脊柱/胸/颈/头/肩/双臂多频正弦叠加，
 *                        并把「自然站姿」直接烘进关键帧，因此单独播放就已经是
 *                        「自然站姿 + 持续微动」，不依赖额外的基础姿势层
 * 3. createBreathClip —— 整体呼吸（根节点缩放 ±0.6%）
 * 4. VrmIdleController—— 用 AnimationMixer 统一管理播放 / 启停 / 权重过渡
 *
 * 为什么改用 AnimationMixer，而不是在渲染循环里逐帧直接写骨骼：
 * - 逐帧直接写骨骼无法与「多路动作叠加」共存（后续接入 .vrma 动作、说话时的身体小动作），
 *   且没有权重过渡，切换动作会跳变；Mixer 是 three 的标准解法，支持 fadeIn/fadeOut。
 * - 关键帧之间由 three 做四元数插值，比逐帧手写正弦更平滑（尤其在掉帧时）。
 * - 复用 super-ai-browser 已线上验证的曲线参数，避免重新调参。
 *
 * 眨眼仍沿用 VrmStage 里基于随机间隔的逐帧实现（而非本模块的 clip 方案）：
 * 随机间隔比固定 6 秒周期自然，且与口型共用 expressionManager，集中在一处写入避免互相覆盖。
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import {
  createVRMAnimationClip,
  VRMAnimationLoaderPlugin,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation'

/**
 * 待机动画时长（秒）。
 *
 * 与 super-ai-browser 的 600s 视觉速度完全一致，只是把「基准周期数」同步缩小：
 * 原实现 rate = 200π / 600 ≈ 1.047 rad/s，本实现 rate = 2π * 20 / 120 ≈ 1.047 rad/s。
 * 周期数取整数倍，保证 t=0 与 t=duration 的相位一致 —— 动画无缝循环，不会在接缝处跳变。
 */
const IDLE_DURATION = 120

/** 采样帧率。最慢的基准周期约 6s，10fps 采样后由四元数插值补平，肉眼完全平滑 */
const IDLE_FPS = 10

/** 基准角频率：每 IDLE_DURATION 秒走 20 个完整周期 */
const IDLE_BASE_RATE = (Math.PI * 2 * 20) / IDLE_DURATION

/**
 * 待机摆动幅度倍率。
 *
 * super-ai-browser 按「全身立绘」调参，本项目只取上半身构图（相机更近），
 * 沿用原幅度会显得几乎静止；这里统一放大摆幅而**不动基准姿势**，
 * 让桌面伴侣在近距离下也有清晰的生命感。想更安静改这一个常量即可。
 */
const IDLE_AMPLITUDE = 1.8

/** 呼吸幅度（根节点缩放的相对变化量，4 秒一个周期） */
const BREATH_AMPLITUDE = 0.008

/**
 * 各肢体的随机相位。
 *
 * 若所有骨骼同相位，角色会像钟摆一样整体同步摆动，非常机械；
 * 随机错开后才有「呼吸、重心游移、头部无意识转动」的松散感。
 */
const IDLE_OFFSETS = {
  body: Math.random() * Math.PI * 2,
  leftArm: Math.random() * Math.PI * 2,
  rightArm: Math.random() * Math.PI * 2,
  head: Math.random() * Math.PI * 2,
}

// --------------------------------------------
// VRMA 动作（.vrma）参数
// --------------------------------------------

/**
 * 动作淡入 / 淡出时长（秒）。
 *
 * 0.5s 足以掩盖「程序化站姿 ↔ 动作首帧」之间的姿势差异，
 * 再长会让动作起手变得含糊（感觉慢半拍）。
 */
const ACTION_FADE_IN = 0.5
const ACTION_FADE_OUT = 0.6

/**
 * 两次 VRMA 动作之间「回到自然站姿」的停留时长区间（秒）。
 *
 * 太短：动作接连不断，像抽搐，且看不清站姿；
 * 太长：被感知为「卡住不动」（这正是此前的问题）。
 * 取随机值让节奏不规律，避免机械感。
 */
const IDLE_HOLD_MIN = 2
const IDLE_HOLD_MAX = 4.5

/**
 * 模型刚加载完到第一个 VRMA 动作的延迟（秒）。
 *
 * 先让角色以自然站姿立住再开始动作：立刻起手会让加载瞬间显得突兀，
 * 也不利于用户第一眼确认「站姿正确」。
 */
const FIRST_ACTION_DELAY = 1.2

/**
 * 从动作资源 URL 推导动作名（小写、去扩展名）。
 *
 * 资源 id 形如 `builtin:greeting.vrma`（`source:文件名`），URL 为
 * `vrm-asset://asset/<encodeURIComponent(id)>`；取文件名去扩展名即动作名。
 *
 * 这个名称是「AI 按名播放动作」的唯一标识（play_action name="greeting"），
 * 因此必须与展示给用户的动作名一致（VrmCompanionStore.listAnimations 的 name）。
 */
export function actionNameFromUrl(url: string): string {
  const stripExt = (s: string): string => s.replace(/\.[^.]+$/, '').toLowerCase()
  try {
    const id = decodeURIComponent(new URL(url).pathname).replace(/^\//, '')
    return stripExt(id.split(':').pop() || id)
  } catch {
    // URL 解析失败（调试页传入本地路径等）时退回字符串处理
    return stripExt(url.split(/[/\\]/).pop() || url)
  }
}

/**
 * VRM 版本的旋转方向系数。
 *
 * VRM 0.x 与 1.x 的归一化骨骼坐标系朝向相反，同一套旋转量需要取反；
 * 取错会导致手臂向身体内侧穿模。
 */
function versionSign(vrm: VRM): number {
  return vrm.meta?.metaVersion === '1' ? 1 : -1
}

/**
 * 自然站姿（A-Pose）。
 *
 * 模型加载完的默认姿势是 T-Pose（双臂平举），直接用会像木偶一样僵硬；
 * 这里把上臂绕 Z 轴压下约 81°，手腕轻微内收，手指逐节微曲，
 * 后续待机动画再在此基准上叠加摆动。
 */
export function applyNaturalPose(vrm: VRM): void {
  const humanoid = vrm.humanoid
  if (!humanoid) return

  const v = versionSign(vrm)

  // 双臂：贴向身体并微微前倾
  const leftArm = humanoid.getNormalizedBoneNode('leftUpperArm')
  if (leftArm) {
    leftArm.rotation.z = -0.45 * Math.PI * v
    leftArm.rotation.x = 0.05
  }
  const rightArm = humanoid.getNormalizedBoneNode('rightUpperArm')
  if (rightArm) {
    rightArm.rotation.z = 0.45 * Math.PI * v
    rightArm.rotation.x = 0.05
  }

  // 手腕：自然内收
  const leftHand = humanoid.getNormalizedBoneNode('leftHand')
  if (leftHand) {
    leftHand.rotation.z = 0.1 * v
    leftHand.rotation.x = 0.05
  }
  const rightHand = humanoid.getNormalizedBoneNode('rightHand')
  if (rightHand) {
    rightHand.rotation.z = -0.1 * v
    rightHand.rotation.x = 0.05
  }

  // 手指：按指节远端依次加大弯曲度（模型不一定有手指骨骼，逐个判空）
  const fingerBones: VRMHumanBoneName[] = [
    'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
    'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
    'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
    'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
    'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
    'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
    'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
    'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
    'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
    'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
  ]

  for (const boneName of fingerBones) {
    const bone = humanoid.getNormalizedBoneNode(boneName)
    if (!bone) continue
    const isLeft = boneName.includes('left')
    if (boneName.includes('Thumb')) {
      bone.rotation.y = isLeft ? 0.35 : -0.35
    } else if (boneName.includes('Proximal')) {
      bone.rotation.z = isLeft ? -0.35 * v : 0.35 * v
    } else if (boneName.includes('Intermediate')) {
      bone.rotation.z = isLeft ? -0.45 * v : 0.45 * v
    } else if (boneName.includes('Distal')) {
      bone.rotation.z = isLeft ? -0.3 * v : 0.3 * v
    }
  }
}

/**
 * 生成程序化待机动画。
 *
 * 输出的是「归一化骨骼」的四元数轨道 —— 轨道名用 bone.name（three-vrm 生成的
 * `Normalized_*` 节点名），Mixer 在 vrm.scene 子树内按名字绑定，与 super-ai-browser 一致。
 *
 * @returns 无任何可动画骨骼时返回 null（例如极简模型）
 */
export function createIdleClip(vrm: VRM): THREE.AnimationClip | null {
  const humanoid = vrm.humanoid
  if (!humanoid) return null

  const v = versionSign(vrm)
  const frameCount = Math.round(IDLE_DURATION * IDLE_FPS)

  const times: number[] = []
  for (let i = 0; i <= frameCount; i++) times.push(i / IDLE_FPS)

  /** 参与待机动画的骨骼（下肢不动，桌面伴侣只取上半身构图） */
  const animatedBones: VRMHumanBoneName[] = [
    'spine', 'chest', 'neck', 'head',
    'leftUpperArm', 'leftLowerArm', 'leftHand', 'leftShoulder',
    'rightUpperArm', 'rightLowerArm', 'rightHand', 'rightShoulder',
  ]

  const tracks: THREE.KeyframeTrack[] = []
  const euler = new THREE.Euler()
  const quaternion = new THREE.Quaternion()

  for (const boneName of animatedBones) {
    const bone = humanoid.getNormalizedBoneNode(boneName)
    if (!bone) continue

    const values: number[] = []

    for (const time of times) {
      /** 基准相位（rad）。各骨骼再乘不同频率系数，形成多频叠加的松散感 */
      const phase = time * IDLE_BASE_RATE
      euler.set(0, 0, 0)

      switch (boneName) {
        case 'spine':
          euler.set(
            Math.sin(phase * 0.6 + IDLE_OFFSETS.body) * 0.02 * IDLE_AMPLITUDE,
            0,
            Math.cos(phase * 0.5 + IDLE_OFFSETS.body) * 0.015 * IDLE_AMPLITUDE,
          )
          break

        case 'chest':
          euler.set(
            Math.sin(phase * 0.6 + IDLE_OFFSETS.body) * 0.01 * IDLE_AMPLITUDE,
            0,
            Math.cos(phase * 0.5 + IDLE_OFFSETS.body) * 0.0075 * IDLE_AMPLITUDE,
          )
          break

        case 'neck':
          euler.set(
            Math.cos(phase * 1.2 + IDLE_OFFSETS.head) * 0.01 * IDLE_AMPLITUDE,
            Math.sin(phase * 1.5 + IDLE_OFFSETS.head) * 0.02 * IDLE_AMPLITUDE,
            0,
          )
          break

        case 'head':
          euler.set(
            Math.sin(phase * 1.0 + IDLE_OFFSETS.head) * 0.02 * IDLE_AMPLITUDE,
            Math.sin(phase * 1.5 + IDLE_OFFSETS.head) * 0.03 * IDLE_AMPLITUDE,
            Math.cos(phase * 0.8 + IDLE_OFFSETS.head) * 0.01 * IDLE_AMPLITUDE,
          )
          break

        case 'leftUpperArm':
          euler.set(
            Math.cos(phase * 0.7 + IDLE_OFFSETS.leftArm) * 0.03 * IDLE_AMPLITUDE,
            Math.sin(phase * 0.6 + IDLE_OFFSETS.leftArm) * 0.02 * IDLE_AMPLITUDE,
            -0.4 * Math.PI * v + Math.sin(phase * 1.5 + IDLE_OFFSETS.leftArm) * 0.03 * IDLE_AMPLITUDE,
          )
          break

        case 'leftLowerArm':
          euler.set(0, 0, -Math.sin(phase * 1.5 + IDLE_OFFSETS.leftArm) * 0.02 * IDLE_AMPLITUDE)
          break

        case 'leftHand':
          euler.set(
            0.05,
            0,
            0.1 * v + Math.sin(phase * 1.2 + IDLE_OFFSETS.leftArm) * 0.015 * IDLE_AMPLITUDE,
          )
          break

        case 'leftShoulder':
          euler.set(0, 0, Math.sin(phase * 0.7 + IDLE_OFFSETS.leftArm) * 0.02 * IDLE_AMPLITUDE)
          break

        case 'rightUpperArm':
          euler.set(
            Math.cos(phase * 0.8 + IDLE_OFFSETS.rightArm) * 0.03 * IDLE_AMPLITUDE,
            Math.sin(phase * 0.64 + IDLE_OFFSETS.rightArm) * 0.02 * IDLE_AMPLITUDE,
            0.4 * Math.PI * v + Math.sin(phase * 1.5 + IDLE_OFFSETS.rightArm) * 0.03 * IDLE_AMPLITUDE,
          )
          break

        case 'rightLowerArm':
          euler.set(0, 0, Math.sin(phase * 1.5 + IDLE_OFFSETS.rightArm) * 0.02 * IDLE_AMPLITUDE)
          break

        case 'rightHand':
          euler.set(
            0.05,
            0,
            -0.1 * v + Math.sin(phase * 1.2 + IDLE_OFFSETS.rightArm) * 0.015 * IDLE_AMPLITUDE,
          )
          break

        case 'rightShoulder':
          euler.set(0, 0, Math.sin(phase * 0.8 + IDLE_OFFSETS.rightArm) * 0.02 * IDLE_AMPLITUDE)
          break

        default:
          break
      }

      quaternion.setFromEuler(euler)
      values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
    }

    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values))
  }

  if (tracks.length === 0) return null
  return new THREE.AnimationClip('vrm-idle', IDLE_DURATION, tracks)
}

/**
 * 生成呼吸动画：对根节点做 ±0.6% 的缩放脉动，4 秒一个周期。
 *
 * 注意根节点必须有 name，否则 Mixer 无法按名字绑定轨道 —— 空名时这里补一个。
 * 不做骨骼级呼吸的原因是：three-vrm 的 humanoid.update() 不传导 scale，
 * 写骨骼 scale 不会生效（早期踩过的坑），而根节点 scale 是真正生效的。
 */
export function createBreathClip(root: THREE.Object3D): THREE.AnimationClip {
  if (!root.name) root.name = 'VRMCompanionRoot'

  const duration = 4
  const fps = 30
  const frameCount = duration * fps

  const times: number[] = []
  const values: number[] = []
  for (let i = 0; i <= frameCount; i++) {
    const time = i / fps
    times.push(time)
    const scale = 1 + Math.sin((time * Math.PI) / 2) * BREATH_AMPLITUDE
    values.push(scale, scale, scale)
  }

  const track = new THREE.VectorKeyframeTrack(`${root.name}.scale`, times, values)
  return new THREE.AnimationClip('vrm-breath', duration, [track])
}

/**
 * 待机动作控制器：用 AnimationMixer 驱动「程序化待机 + VRMA 动作 + 呼吸」。
 *
 * 动作编排（参照 super-ai-browser 的 IdleAnimationManager，收敛为一个状态机）：
 *
 *   procedural（自然站姿 + 多频微动，等待） --hold 秒后--> vrma（随机抽一个动作）
 *   vrma（LoopOnce 播完） -------------------finished--> procedural
 *
 * 为什么两条轨道不能同时全权重播放：程序化 idle 与 VRMA 都是「全量四元数轨道」，
 * 作用于同一批归一化骨骼，同时权重 1 会被 Mixer 归一化成 50/50 混合，姿势直接错乱。
 * 因此两者严格互斥，只靠 fadeIn / fadeOut 做权重交接（这也是 super-ai-browser 的做法）。
 *
 * 生命周期：模型加载完成后创建，模型切换 / 组件卸载时 dispose。
 */
export class VrmIdleController {
  private readonly vrm: VRM
  private readonly mixer: THREE.AnimationMixer
  /** 程序化待机（自然站姿 + 微动），同时也是 VRMA 的「等待态」 */
  private readonly proceduralIdleAction: THREE.AnimationAction | null
  /** 呼吸（根节点缩放），与骨骼轨道无冲突，可常驻全权重 */
  private readonly breathAction: THREE.AnimationAction
  private enabled = true
  private disposed = false

  /** 已加载完成的 VRMA 动作 clip */
  private readonly vrmaClips: THREE.AnimationClip[] = []
  /** 与 vrmaClips 一一对应的动作名（小写），供 AI 按名播放 */
  private readonly vrmaNames: string[] = []
  /** 当前正在播放的 VRMA action（等待态为 null） */
  private currentVrmaAction: THREE.AnimationAction | null = null
  /**
   * 被新动作打断、正在淡出的旧 action。
   *
   * AI 连续下达动作指令时，旧动作若不显式淡出会与新动作同时全权重混合，
   * 骨骼姿势直接错乱；淡出到 0 后还需 stop() 释放，否则会一直参与混合计算。
   */
  private readonly retiringActions: THREE.AnimationAction[] = []
  /** 是否处于「正在播放 VRMA」态 */
  private vrmaPlaying = false
  /** 上一次播放的 clip 下标，用于避免连续抽到同一动作 */
  private lastVrmaIndex = -1
  /** 状态机计时器（秒）：距离下一次状态切换的剩余时间 */
  private phaseTimer = FIRST_ACTION_DELAY
  /** 加载批次序号：并发加载时旧批次的结果必须丢弃 */
  private loadToken = 0

  constructor(vrm: VRM) {
    this.vrm = vrm

    // 先落自然站姿，再建 Mixer：Mixer 首次绑定会缓存当时的骨骼值作为「原始值」，
    // 之后所有轨道权重归零时能正确回落到自然站姿而不是 T-Pose。
    applyNaturalPose(vrm)

    this.mixer = new THREE.AnimationMixer(vrm.scene)
    this.mixer.addEventListener('finished', this.handleFinished)

    const idleClip = createIdleClip(vrm)
    if (idleClip) {
      this.proceduralIdleAction = this.mixer.clipAction(idleClip)
      this.proceduralIdleAction.setLoop(THREE.LoopRepeat, Infinity)
      this.proceduralIdleAction.setEffectiveWeight(1)
      this.proceduralIdleAction.play()
    } else {
      this.proceduralIdleAction = null
    }

    const breathClip = createBreathClip(vrm.scene)
    this.breathAction = this.mixer.clipAction(breathClip)
    this.breathAction.setLoop(THREE.LoopRepeat, Infinity)
    this.breathAction.setEffectiveWeight(1)
    this.breathAction.play()
  }

  /**
   * 异步加载 VRMA 动作并加入待机队列。
   *
   * 独立 GLTFLoader（只注册 VRMAnimationLoaderPlugin）：模型 loader 注册的是
   * VRMLoaderPlugin，两者解析目标不同，共用会让 userData 归属混乱。
   * 加载失败/某个动作损坏都不影响其余动作 —— 全部失败时退化为纯程序化待机。
   */
  async loadAnimations(urls: string[]): Promise<void> {
    if (this.disposed || urls.length === 0) return

    // 去重：上层在「新增动作」时会把全量 URL 再传一次（见 VrmStage 的 animationUrls effect）。
    // 已加载过的动作名直接跳过 —— 否则同一动作会累积多份 clip，
    // 既浪费显存，也会让 AI 的按名播放/动作清单出现重复项。
    const pending = urls.filter((url) => !this.vrmaNames.includes(actionNameFromUrl(url)))
    if (pending.length === 0) return

    const token = ++this.loadToken
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

    const settled = await Promise.allSettled(pending.map((url) => loader.loadAsync(url)))
    if (this.disposed || token !== this.loadToken) return

    // 逐个 url 处理（settled 与 urls 下标一一对应），
    // 这样才能把动作名与 clip 一一绑定 —— 按名播放依赖这层映射。
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]
      if (result.status !== 'fulfilled') continue
      const animations = result.value.userData.vrmAnimations as VRMAnimation[] | undefined
      if (!animations || animations.length === 0) continue

      const name = actionNameFromUrl(pending[i])
      for (const animation of animations) {
        try {
          const clip = createVRMAnimationClip(animation, this.vrm)
          if (clip) {
            this.vrmaClips.push(clip)
            this.vrmaNames.push(name)
          }
        } catch {
          /* 单个动作转换失败不影响其余 */
        }
      }
    }
  }

  /** 已就绪的动作数量（供上层日志/调试） */
  get animationCount(): number {
    return this.vrmaClips.length
  }

  /** 可用动作清单（下标 + 名称），供 AI 指令按名选片 */
  get actions(): Array<{ index: number; name: string }> {
    return this.vrmaNames.map((name, index) => ({ index, name }))
  }

  /**
   * 立即播放指定下标的动作（AI / 交互触发）。
   *
   * 与自动待机队列共用同一条「独占通道」：起手新动作会打断并淡出正在播放的动作，
   * 播完自动回到程序化待机 —— 不会出现两条全量四元数轨道同时生效的姿势错乱。
   *
   * @returns 下标越界或控制器已销毁时返回 false
   */
  playActionByIndex(index: number): boolean {
    if (this.disposed) return false
    const clip = this.vrmaClips[index]
    if (!clip) return false
    this.lastVrmaIndex = index
    this.playVrma(clip)
    return true
  }

  /**
   * 按动作名播放（大小写不敏感；先精确匹配，再前缀/包含匹配）。
   *
   * 名称来自文件名（如 greeting / peace_sign），见 actionNameFromUrl。
   *
   * @returns 未找到匹配动作时返回 false
   */
  playActionByName(name: string): boolean {
    if (this.disposed) return false
    const target = name.trim().toLowerCase()
    if (!target) return false

    let index = this.vrmaNames.indexOf(target)
    if (index < 0) {
      index = this.vrmaNames.findIndex((n) => n === target.replace(/[\s-]+/g, '_'))
    }
    if (index < 0) {
      index = this.vrmaNames.findIndex((n) => n.includes(target) || target.includes(n))
    }
    if (index < 0) return false

    return this.playActionByIndex(index)
  }

  /** 立即结束当前一次性动作，回到程序化待机（AI 的 reset 指令） */
  stopAction(): void {
    if (this.disposed || !this.vrmaPlaying) return
    this.switchToProcedural()
  }

  /**
   * 启停待机动作。
   *
   * 用 timeScale 冻结而非把权重降到 0：权重归零会让 Mixer 回落到绑定时的原始值，
   * 可能瞬间跳姿势；timeScale=0 是「原地定格」，恢复时无跳变（super-ai-browser 同做法）。
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.mixer.timeScale = enabled ? 1 : 0
  }

  /** 每帧推进。必须在 vrm.update() 之前调用，保证本帧就传导到 raw 骨骼 */
  update(delta: number): void {
    // 冻结时同时停止状态机计时，否则恢复瞬间会补踢出一次动作切换
    if (this.disposed || !this.enabled) return

    this.recycleFinishedAction()
    this.advanceState(delta)
    this.mixer.update(delta)
  }

  /** 释放：停止所有动作并清空 Mixer 缓存，避免切换模型时残留 */
  dispose(): void {
    this.disposed = true
    this.mixer.removeEventListener('finished', this.handleFinished)
    this.mixer.stopAllAction()
    this.retiringActions.length = 0
    this.vrmaClips.length = 0
    this.vrmaNames.length = 0
    this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D)
  }

  // --------------------------------------------
  // 内部：状态机
  // --------------------------------------------

  /** VRMA 播完 → 回到程序化待机并开启下一次动作的等待计时 */
  private readonly handleFinished = (event: THREE.Event & { action?: THREE.AnimationAction }): void => {
    if (this.disposed) return
    if (!this.vrmaPlaying || event.action !== this.currentVrmaAction) return
    this.switchToProcedural()
  }

  /** 推进等待计时；到点且当前处于等待态时，起手下一个 VRMA 动作 */
  private advanceState(delta: number): void {
    if (this.vrmaPlaying) return
    if (this.vrmaClips.length === 0) return

    this.phaseTimer -= delta
    if (this.phaseTimer > 0) return

    const clip = this.vrmaClips[this.pickNextIndex()]
    this.playVrma(clip)
  }

  /**
   * 随机挑选下一个动作的下标。
   *
   * 重试若干次以避开上一次的动作，避免「同一个动作连着来两次」的重复感；
   * 只有 1 个动作时直接复用。
   */
  private pickNextIndex(): number {
    const total = this.vrmaClips.length
    if (total <= 1) return 0
    let index = this.lastVrmaIndex
    for (let i = 0; i < 8 && index === this.lastVrmaIndex; i++) {
      index = Math.floor(Math.random() * total)
    }
    this.lastVrmaIndex = index
    return index
  }

  /**
   * 起手一个 VRMA 动作：LoopOnce + clampWhenFinished，与程序化待机做权重交接。
   *
   * 权重必须先设为 1 再 fadeIn：fadeIn 是「在基础权重上乘一条 0→1 的插值曲线」，
   * 若基础权重为 0，乘积恒为 0，动作会完全不可见（真机踩过的坑）。
   */
  private playVrma(clip: THREE.AnimationClip): void {
    const previous = this.currentVrmaAction

    const action = this.mixer.clipAction(clip)
    action.reset()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.setEffectiveWeight(1)
    action.play()
    action.fadeIn(ACTION_FADE_IN)

    // 打断正在播放的动作：显式淡出旧 action，避免与新动作同时全权重混合。
    // 加入 retiring 队列，等权重降到 0 后再 stop()（见 recycleFinishedAction）。
    if (previous && previous !== action) {
      previous.fadeOut(ACTION_FADE_IN)
      this.retiringActions.push(previous)
    }

    this.proceduralIdleAction?.fadeOut(ACTION_FADE_IN)
    this.currentVrmaAction = action
    this.vrmaPlaying = true
  }

  /** 切回程序化待机，并随机安排下一次动作的等待时长 */
  private switchToProcedural(): void {
    this.vrmaPlaying = false
    this.currentVrmaAction?.fadeOut(ACTION_FADE_OUT)

    const procedural = this.proceduralIdleAction
    if (procedural) {
      // 关键：three 在 fadeOut 把权重降到 0 后会把 action 置为 enabled=false，
      // 之后 _updateWeight 直接返回 0，仅靠 fadeIn 永远恢复不了 ——
      // 必须显式 enabled=true + play() 重新激活，否则待机动作会永久停摆（只剩呼吸在动）。
      const wasActive = procedural.enabled && procedural.getEffectiveWeight() > 0.001
      procedural.enabled = true
      procedural.setEffectiveWeight(1)
      procedural.play()
      // 已经在混合中（权重 > 0）时不淡入，避免「1 → 0 → 1」的权重闪动
      if (!wasActive) procedural.fadeIn(ACTION_FADE_OUT)
    }

    this.phaseTimer = IDLE_HOLD_MIN + Math.random() * (IDLE_HOLD_MAX - IDLE_HOLD_MIN)
  }

  /** 淡出完成后停止并释放 VRMA action，避免权重为 0 的 action 持续参与混合计算 */
  private recycleFinishedAction(): void {
    // 被打断的旧动作：权重降到 0 后释放
    for (let i = this.retiringActions.length - 1; i >= 0; i--) {
      const retiring = this.retiringActions[i]
      if (retiring.getEffectiveWeight() > 0.001) continue
      retiring.stop()
      this.retiringActions.splice(i, 1)
    }

    const action = this.currentVrmaAction
    if (!action || this.vrmaPlaying) return
    if (action.getEffectiveWeight() > 0.001) return
    action.stop()
    this.currentVrmaAction = null
  }
}

