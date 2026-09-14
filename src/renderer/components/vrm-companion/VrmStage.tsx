/**
 * VrmStage — VRM 角色 3D 渲染舞台
 *
 * 使用原生 Three.js + @pixiv/three-vrm 渲染桌面伴侣形象。
 * 不用 @react-three/fiber 的原因：
 * VRM 需要精细的生命周期控制（加载/切换/销毁/骨骼驱动），
 * 且口型需逐帧写入（60fps），走 R3F 的 re-render 路径会产生无谓开销。
 *
 * 职责：
 * - 创建 WebGL 渲染器（透明背景，适配 Electron 透明窗口）
 * - 加载 VRM 模型（vrm-asset:// 协议 URL），自动适配相机取景为上半身
 * - 逐帧驱动：AnimationMixer 推进待机动作（自然站姿 / 摆动 / 呼吸）+ VRM update
 *   + 眨眼 / 口型（读 mouthOpenRef），最后 render
 *
 * 清理：组件卸载/切换模型时彻底 dispose（几何体/材质/纹理/WebGL 上下文），
 * 避免长时间驻留导致显存泄漏。
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { logger } from '@shared/toolkit/LogEngine'
import { VrmIdleController } from './vrmIdleAnimation'

export interface VrmStageProps {
  /** 模型资源 URL（vrm-asset://asset/<id>）；为 null 时不加载 */
  modelUrl: string | null
  /** 角色缩放（1 为默认；>1 放大，<1 缩小） */
  scale: number
  /** 口型开合值（0~1），由 useVrmLipSync 提供，渲染循环逐帧读取 */
  mouthOpenRef: React.MutableRefObject<number>
  /** 待机动作：呼吸 / 身体摇摆 / 手臂摆动 / 眨眼 */
  idleEnabled?: boolean
  /** 视线跟随鼠标（驱动 VRM lookAt：眼睛 + 头部朝向） */
  lookAtEnabled?: boolean
  /**
   * 鼠标位置（归一化到 -1 ~ 1，相对窗口中心）。
   *
   * 用 ref 逐帧传递而非 state：鼠标移动频率高，走 React 重渲染会明显掉帧。
   */
  pointerRef?: React.MutableRefObject<{ x: number; y: number }>
  /**
   * 待机动作资源 URL 列表（.vrma）。
   *
   * 由上层从主进程拉取后传入：渲染组件不直接依赖 IPC，
   * 也便于在浏览器调试页（vrm-test）里注入本地动作做验证。
   */
  animationUrls?: string[]
  /**
   * 自动隐藏：鼠标悬停在角色上时让画布淡出，并通知上层开启窗口鼠标穿透。
   *
   * 用途：角色挡住桌面内容时，鼠标一碰到它就自动让位，移开后淡入 ——
   * 既能正常操作下方内容，又不失去陪伴感（对齐 super-ai-browser 的 auto-hide）。
   */
  autoHide?: boolean
  /**
   * 悬停状态变化（true = 悬停确认后角色已淡出让位），上层据此开启临时穿透。
   *
   * 注意这里带「悬停确认延时」，只用于 autoHide；
   * 需要即时悬停结果（浮出操作栏 / 临时接管鼠标事件）请用 onPointerOverChange。
   */
  onHoverChange?: (hovering: boolean) => void
  /**
   * 指针是否位于窗口内（主进程轮询 / DOM 事件维护）。
   *
   * 用于门控悬停射线检测：指针不在窗口内时 pointerRef 是过期值，
   * 会误判为「压在角色上」，导致指针离开后悬停状态卡死、窗口再也不让开点击。
   * 不传时视为「始终在窗口内」（兼容 vrm-test 等调试页）。
   */
  pointerInsideRef?: React.MutableRefObject<boolean>
  /**
   * 指针是否压在角色上（原始检测结果，无延时，节流上报）。
   *
   * 用途：桌面伴侣开启鼠标穿透后，鼠标移到角色上仍要浮出操作栏 ——
   * 上层据此显示操作栏，并在指针压到操作栏时让窗口临时接管鼠标事件。
   */
  onPointerOverChange?: (over: boolean) => void
  /** 加载完成回调 */
  onReady?: () => void
  /** 加载失败回调 */
  onError?: (message: string) => void
}

/**
 * VrmStage 对外暴露的命令式能力（经 ref 调用）。
 *
 * 这批接口同时服务于两个消费方：
 * 1. 伴侣窗口自身的控制栏（复位视角）
 * 2. AI 动作指令（companion_control 工具 → 主进程 → 伴侣窗口）
 *    动作/表情必须走命令式调用而不是 props：逐帧渲染循环里读 ref，
 *    走 props 会因 React 重渲染与渲染循环不同拍（动作可能丢帧或延迟一整轮）。
 */
export interface VrmStageHandle {
  /** 视角复位到默认正面机位（拖动旋转后一键回正） */
  resetView: () => void
  /**
   * 播放一次性动作。
   *
   * @param name 动作名（如 greeting / peace_sign；支持别名由上层解析）；
   *             缺省时随机播放一个
   * @returns 是否成功找到并播放（动作未加载/名称不存在时为 false）
   */
  playAction: (name?: string) => boolean
  /** 立即结束当前一次性动作，回到自然站姿待机 */
  stopAction: () => void
  /** 可用动作清单（下标 + 名称），供上层/AI 了解能播什么 */
  listActions: () => Array<{ index: number; name: string }>
  /**
   * 设置表情。
   *
   * @param name VRM 预设表情名（happy / angry / sad / relaxed / surprised / neutral 等）
   * @param weight 强度 0~1（默认 1）
   * @param durationMs 保持时长，到期自动衰减（缺省 2600ms；传 0 表示不自动清除）
   */
  setExpression: (name: string, weight?: number, durationMs?: number) => void
  /** 立即清除表情覆盖（但不清除自然表情基线） */
  clearExpression: () => void
  /**
   * 视线目标覆盖。
   * - cursor：跟随鼠标（默认行为）
   * - camera：看向镜头
   * - center：正视前方
   */
  setLookAt: (target: 'cursor' | 'camera' | 'center') => void
}

/** 相机视场角 */
const CAMERA_FOV = 30
/** 取景区域高度占模型总高的比例（0.55 ≈ 上半身） */
const FRAME_HEIGHT_RATIO = 0.55
/**
 * 取景框顶部的留白（占取景区域高度的比例）。
 *
 * 旧实现按「模型高度的固定比例」定位取景中心，在缩小（scale < 1）时刚好，
 * 但放大（scale > 1）时取景框整体压在头顶以下 —— 用户把角色调大后头部就被裁掉。
 * 改为「取景框顶部 = 模型最高点 + 留白」反推中心，则无论放大到几倍，头顶始终在画面内。
 */
const FRAME_HEADROOM_RATIO = 0.06
/**
 * 取景需保证可见的最小横向宽度（占模型总高比例，约「肩宽 + 手臂余量」）。
 *
 * 伴侣窗口很窄时（如 200×480）横向视野比肩膀还窄，角色两侧同样会被裁；
 * 据此反推最小相机距离即可保证左右不被切。
 * 注意不要用包围盒宽度：模型初始是 T-Pose，包围盒宽度接近身高，
 * 会把相机推到很远、角色变成极小一点。
 *
 * 该值在取景计算中随 scale 一同收窄：放大本身就是「看得更少、看得更大」，
 * 若宽度要求恒定，放大到一定倍数后它就会永久主导相机距离，滑块后半段直接失效。
 */
const FRAME_MIN_WIDTH_RATIO = 0.34

/**
 * 环绕视角的极角限制（弧度；0 = 相机在正上方，π/2 = 水平视线）。
 *
 * 允许「斜上方俯视 ↔ 斜下方仰视」，但不允许绕到地面以下 ——
 * 那样只能从脚底往上看，画面里只剩鞋子和空场景。
 */
const ORBIT_MIN_POLAR = 0.35
const ORBIT_MAX_POLAR = 2.35
/** 环绕阻尼：松手后惯性滑行，手感更顺（OrbitControls 逐帧 update 推进） */
const ORBIT_DAMPING = 0.08
/**
 * 自动隐藏的「悬停确认时长」（ms）。
 *
 * 悬停需要持续这么久才真正隐藏，顺带给旋转视角留出时间窗：
 * 鼠标扫过角色后立刻按下拖拽时，隐藏尚未生效（窗口仍在接收事件），
 * 拖拽一开始就不会再隐藏。
 */
const AUTO_HIDE_HOVER_DELAY = 220

/** 复用的临时向量/球坐标（渲染循环与取景计算复用，避免产生 GC 压力） */
const _tmpHeadPos = new THREE.Vector3()
const _tmpLookAtPos = new THREE.Vector3()
const _tmpCamDir = new THREE.Vector3()
const _tmpCamRight = new THREE.Vector3()
const _tmpCamUp = new THREE.Vector3()
const _tmpOffset = new THREE.Vector3()
const _tmpTarget = new THREE.Vector3()
const _tmpSpherical = new THREE.Spherical()
const _tmpNdc = new THREE.Vector2()

/** 悬停检测间隔（ms）。射线检测要遍历整棵角色树，节流后开销可忽略 */
const HOVER_CHECK_INTERVAL = 110

/** 自动隐藏的淡入/淡出时长（ms），与 super-ai-browser 观感对齐 */
const AUTO_HIDE_FADE_MS = 300

/**
 * 切换画布可见性（CSS 过渡淡入淡出）。
 *
 * 用 CSS opacity 而不是改模型材质：不动模型材质状态、切换零成本，
 * 且与「窗口鼠标穿透」天然同拍 —— 画布透明时窗口也刚好不接收点击。
 */
function setCanvasHidden(renderer: THREE.WebGLRenderer | null, hidden: boolean): void {
  const el = renderer?.domElement
  if (!el) return
  el.style.transition = `opacity ${AUTO_HIDE_FADE_MS}ms ease`
  el.style.opacity = hidden ? '0' : '1'
}

/** 相机取景结果（模型坐标系） */
interface Framing {
  /** 环绕中心高度 */
  targetY: number
  /** 相机到环绕中心的距离 */
  distance: number
}

/**
 * 计算相机取景（上半身构图），保证放大时头顶与身体两侧都不被裁。
 *
 * 纵向与横向两条约束取「相机更远」的那条：
 * 1. 纵向：取景框高度 = 模型高 × FRAME_HEIGHT_RATIO / scale，框顶对齐「模型最高点 + 留白」
 * 2. 横向：可见宽度 ≥ 模型高 × FRAME_MIN_WIDTH_RATIO / scale（窄窗口时自动拉远）
 *
 * 横向要求必须同样除以 scale：否则放大到一定倍数后横向兜底会永久主导，
 * 相机距离不再变化（滑块后半段「放大没反应」），而取景中心仍按纵向公式推导，
 * 二者不一致会让画面整体错位 —— 头顶空出一大片、角色被顶出画面下边界。
 *
 * 另外，环绕中心必须用「最终距离反推出的实际框高」来定位，而不是用纵向公式里的
 * 目标框高：只有这样才能保证「框顶 = 模型最高点 + 留白」在兜底生效时依然成立。
 */
function computeFraming(vrm: VRM, scale: number, aspect: number): Framing {
  const box = new THREE.Box3().setFromObject(vrm.scene)
  const size = new THREE.Vector3()
  box.getSize(size)
  const modelHeight = size.y > 0.1 ? size.y : 1.6
  const safeScale = scale > 0 ? scale : 1
  const safeAspect = aspect > 0.05 ? aspect : 1
  const tanHalfFov = Math.tan((CAMERA_FOV * Math.PI) / 360)

  // 1) 纵向取景：框高随放大收窄（等效于角色变大）
  const frameHeight = (modelHeight * FRAME_HEIGHT_RATIO) / safeScale
  let distance = frameHeight / 2 / tanHalfFov

  // 2) 横向兜底：窗口过窄时按最小可见宽度把相机拉远（宽度要求同步随 scale 收窄）
  const distanceForWidth =
    (modelHeight * FRAME_MIN_WIDTH_RATIO) / safeScale / 2 / (tanHalfFov * safeAspect)
  if (distanceForWidth > distance) distance = distanceForWidth

  // 3) 用最终距离反推实际框高，再定位环绕中心：框顶恒为「模型最高点 + 留白」
  const actualFrameHeight = 2 * distance * tanHalfFov
  const targetY =
    box.max.y + actualFrameHeight * FRAME_HEADROOM_RATIO - actualFrameHeight / 2

  return { targetY, distance }
}


/**
 * 应用取景：保留用户当前的环绕角度，只更新环绕中心与相机距离。
 *
 * 「保留角度」很关键 —— 否则每次调缩放 / 改窗口尺寸都会把用户转到的侧面视角
 * 强行拉回正面。做法是从当前相机位置反解球坐标，再按新半径重新落位。
 */
function applyFraming(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  framing: Framing,
): void {
  const spherical = _tmpSpherical.setFromVector3(
    _tmpOffset.subVectors(camera.position, controls.target),
  )
  const target = _tmpTarget.set(0, framing.targetY, 0)

  _tmpOffset.setFromSphericalCoords(
    framing.distance,
    Math.min(ORBIT_MAX_POLAR, Math.max(ORBIT_MIN_POLAR, spherical.phi)),
    spherical.theta,
  )
  camera.position.copy(target).add(_tmpOffset)
  controls.target.copy(target)
  controls.update()
}

export const VrmStage = forwardRef<VrmStageHandle, VrmStageProps>(function VrmStage(
  {
    modelUrl,
    scale,
    mouthOpenRef,
    idleEnabled = true,
    lookAtEnabled = true,
    pointerRef,
    animationUrls,
    autoHide = false,
    onHoverChange,
    pointerInsideRef,
    onPointerOverChange,
    onReady,
    onError,
  },
  ref,
) {
  /** 挂载容器 */
  const containerRef = useRef<HTMLDivElement | null>(null)
  /** Three.js 资源引用（避免闭包捕获过期实例） */
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const vrmRef = useRef<VRM | null>(null)
  const loaderRef = useRef<GLTFLoader | null>(null)
  /** 当前已加载的 URL（避免重复加载同一模型） */
  const loadedUrlRef = useRef<string | null>(null)
  /** 最新缩放值（异步加载完成时读取，避免闭包捕获过期值） */
  const scaleRef = useRef(scale)
  /** 视线目标：挂在场景里的空对象，逐帧移动到鼠标方向 */
  const lookAtTargetRef = useRef<THREE.Object3D | null>(null)
  /** 待机动作控制器（AnimationMixer 驱动：自然站姿 idle + 呼吸） */
  const idleControllerRef = useRef<VrmIdleController | null>(null)
  /** 待机 / 视线开关（渲染循环逐帧读取，避免闭包捕获过期值） */
  const idleEnabledRef = useRef(idleEnabled)
  const lookAtEnabledRef = useRef(lookAtEnabled)
  /** 平滑后的鼠标位置（避免视线抖动） */
  const pointerSmoothRef = useRef({ x: 0, y: 0 })
  /** 最新动作 URL 列表（模型异步加载完成时读取，避免闭包捕获过期值） */
  const animationUrlsRef = useRef<string[]>(animationUrls ?? [])
  /** 自动隐藏开关（渲染循环逐帧读取，避免闭包捕获过期值） */
  const autoHideRef = useRef(autoHide)
  const onHoverChangeRef = useRef(onHoverChange)
  /** 最新悬停回调 / 指针在窗内的标记（渲染循环逐帧读取，避免闭包捕获过期值） */
  const onPointerOverChangeRef = useRef(onPointerOverChange)
  /** 上次上报的「指针压在角色上」状态（变化时才回调，避免每帧触发上层 setState） */
  const pointerOverRef = useRef(false)
  /** 上一轮检测时指针是否在窗口内（用于「重新进入」时强制重报悬停态） */
  const pointerInsideSeenRef = useRef(true)
  /** 悬停射线检测器（复用实例，避免每次检测都 new 一个） */
  const raycasterRef = useRef(new THREE.Raycaster())
  /** 上次悬停检测时间戳（节流用） */
  const hoverCheckAtRef = useRef(0)
  /** 当前是否处于「因悬停而隐藏」状态 */
  const hoverHiddenRef = useRef(false)

  /** 悬停起始时间戳（0 = 当前未悬停），配合 AUTO_HIDE_HOVER_DELAY 做延时确认 */
  const hoverSinceRef = useRef(0)
  /** 是否正在拖拽旋转视角（拖拽期间不自动隐藏，否则一抓就淡出、转不动） */
  const orbitDraggingRef = useRef(false)
  /**
   * 取景刷新函数（在场景初始化 effect 内赋值）。
   *
   * 抽成 ref 的原因：模型加载完成 / 缩放变化 / 窗口尺寸变化三条路径都要刷新取景，
   * 但相机与控制器的实例只存在于初始化 effect 的闭包里。
   */
  const applyFramingRef = useRef<() => void>(() => {})
  /** 视角复位函数（同上，供 useImperativeHandle 暴露给上层） */
  const resetViewRef = useRef<() => void>(() => {})

  /**
   * 表情覆盖（AI 指令）。
   *
   * 与口型/眨眼分开存放：口型逐帧写 'aa'、眨眼写 'blink'，
   * 覆盖写的是情绪表情（happy/angry/...），三者互不打架。
   * until = 0 表示不自动清除。
   */
  const expressionOverrideRef = useRef<{ name: string; weight: number; until: number } | null>(null)
  /** 上一次实际写入的表情名（到期/清除时需要把它归零） */
  const appliedExpressionRef = useRef<string | null>(null)
  /** 视线目标覆盖（AI 指令）；null / 'cursor' = 跟随鼠标（默认） */
  const lookAtOverrideRef = useRef<'cursor' | 'camera' | 'center' | null>(null)

  /**
   * 判断当前模型是否支持某个表情。
   *
   * 不同 VRM 模型支持的预设表情集合不同（有的缺 relaxed/surprised），
   * 直接 setValue 不存在的表情在 three-vrm 里是静默无效的 ——
   * 这里提前判定，让上层能给出「该模型不支持此表情」的准确反馈。
   */
  const hasExpression = (name: string): boolean => {
    const mgr = vrmRef.current?.expressionManager as unknown as
      | { getExpression?: (n: string) => unknown; expressionMap?: Record<string, unknown> }
      | undefined
    if (!mgr) return false
    if (typeof mgr.getExpression === 'function') return !!mgr.getExpression(name)
    return !!mgr.expressionMap?.[name]
  }

  // 对外暴露：动作 / 表情 / 视线 / 视角复位（供控制栏与 AI 指令调用）
  useImperativeHandle(
    ref,
    (): VrmStageHandle => ({
      resetView: () => resetViewRef.current(),

      playAction: (name?: string): boolean => {
        const controller = idleControllerRef.current
        if (!controller) return false
        if (name) return controller.playActionByName(name)
        // 未指定名称：随机抽一个（与待机队列的「避免连续重复」策略一致）
        const total = controller.animationCount
        if (total <= 0) return false
        return controller.playActionByIndex(Math.floor(Math.random() * total))
      },

      stopAction: () => {
        idleControllerRef.current?.stopAction()
      },

      listActions: () => idleControllerRef.current?.actions ?? [],

      setExpression: (name: string, weight = 1, durationMs = 2600): void => {
        const target = String(name || '').trim().toLowerCase()
        if (!target || !hasExpression(target)) return
        expressionOverrideRef.current = {
          name: target,
          weight: Math.max(0, Math.min(1, weight)),
          until: durationMs > 0 ? performance.now() + durationMs : 0,
        }
      },

      clearExpression: (): void => {
        expressionOverrideRef.current = null
      },

      setLookAt: (target): void => {
        lookAtOverrideRef.current = target
      },
    }),
    [],
  )


  // --------------------------------------------
  // 场景初始化（仅一次）
  // --------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 渲染器：alpha 让透明窗口背景透出
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    })
    renderer.setClearColor(0x00000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth || 320, container.clientHeight || 480, false)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      (container.clientWidth || 320) / (container.clientHeight || 480),
      0.1,
      50,
    )
    // 初始机位：正前方水平视角（极角 π/2、方位角 0），
    // 真正的距离与取景中心由 applyFraming 在模型加载完成后计算
    camera.position.set(0, 1.2, 3)
    cameraRef.current = camera

    // --------------------------------------------
    // 环绕视角（OrbitControls）
    //
    // 鼠标拖拽角色即可 360° 环绕观察（对齐 example/super-ai-browser 的交互）。
    // 只开旋转：缩放由设置里的「角色大小」统一控制，平移会破坏构图 ——
    // 三者同时开启会出现「两套缩放互相打架」。
    // --------------------------------------------
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = ORBIT_DAMPING
    controls.enablePan = false
    controls.enableZoom = false
    controls.rotateSpeed = 0.85
    controls.minPolarAngle = ORBIT_MIN_POLAR
    controls.maxPolarAngle = ORBIT_MAX_POLAR
    controls.target.set(0, 1.2, 0)
    controls.update()

    /** 拖拽开始：标记旋转中（渲染循环据此跳过自动隐藏） */
    const handleControlsStart = (): void => {
      orbitDraggingRef.current = true
      // 万一已处于「悬停隐藏」（画布透明 + 窗口穿透），先恢复，
      // 否则用户会觉得「一碰角色就消失，也转不动」
      if (hoverHiddenRef.current) {
        hoverHiddenRef.current = false
        hoverSinceRef.current = 0
        setCanvasHidden(renderer, false)
        controls.enabled = true
        onHoverChangeRef.current?.(false)
      }
    }
    /** 拖拽结束：解除旋转标记 */
    const handleControlsEnd = (): void => {
      orbitDraggingRef.current = false
    }
    controls.addEventListener('start', handleControlsStart)
    controls.addEventListener('end', handleControlsEnd)

    /** 按当前模型 + 缩放 + 窗口比例刷新取景 */
    const applyFramingNow = (): void => {
      const vrm = vrmRef.current
      const w = container.clientWidth
      const h = container.clientHeight
      if (!vrm || w === 0 || h === 0) return
      applyFraming(camera, controls, computeFraming(vrm, scaleRef.current, w / h))
    }
    applyFramingRef.current = applyFramingNow

    /** 视角复位到默认正面机位（保留当前缩放对应的取景） */
    resetViewRef.current = (): void => {
      const vrm = vrmRef.current
      const w = container.clientWidth
      const h = container.clientHeight
      if (!vrm || w === 0 || h === 0) return
      const framing = computeFraming(vrm, scaleRef.current, w / h)
      controls.target.set(0, framing.targetY, 0)
      camera.position.set(0, framing.targetY, framing.distance)
      camera.updateProjectionMatrix()
      controls.update()
    }

    // 灯光：主光（右上前方）+ 环境光 + 补光（左后），塑造立绘感
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6)
    keyLight.position.set(0.6, 1.6, 1.2)
    scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight(0xa5c8ff, 0.5)
    fillLight.position.set(-1.2, 0.8, -0.8)
    scene.add(fillLight)

    const ambient = new THREE.AmbientLight(0xffffff, 1.1)
    scene.add(ambient)

    // 视线目标：lookAt 需要一个处于场景中的 Object3D 才能拿到世界坐标
    const lookAtTarget = new THREE.Object3D()
    lookAtTarget.name = 'VrmLookAtTarget'
    scene.add(lookAtTarget)
    lookAtTargetRef.current = lookAtTarget

    // GLTFLoader + VRM 插件
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loaderRef.current = loader

    // --------------------------------------------
    // 渲染循环
    // --------------------------------------------
    const clock = new THREE.Clock()
    let rafId = 0
    /** 眨眼状态机 */
    let nextBlinkAt = performance.now() + 2000 + Math.random() * 3000
    let blinkUntil = 0

    const animate = (): void => {
      rafId = requestAnimationFrame(animate)

      const delta = clock.getDelta()
      const vrm = vrmRef.current
      const now = performance.now()
      if (vrm) {
        const humanoid = vrm.humanoid
        const head = humanoid?.getNormalizedBoneNode('head')

        // --------------------------------------------
        // 1. 待机动作：交由 AnimationMixer 推进
        //
        // 「自然站姿 + 多频微动（脊柱/胸/颈/头/肩/双臂）」已烘进关键帧轨道，
        // 见 vrmIdleAnimation.ts。相比逐帧手写正弦：掉帧时由四元数插值补平，
        // 且后续能叠加 .vrma 动作；必须在 vrm.update() 之前 update，
        // 归一化骨骼才能当帧传导到 raw 骨骼。
        // --------------------------------------------
        idleControllerRef.current?.update(delta)

        // --------------------------------------------
        // 2. 视线目标：把场景中的空对象移动到「头部前方 + 鼠标偏移」位置
        //
        // 左右/上下偏移量按「相机屏幕方向」展开（而不是世界坐标轴）：
        // 环绕视角转到侧面或背面后，鼠标往右角色依然往右看，不会反向。
        // 正视角下 camRight = +X、camUp = +Y，与旧实现完全一致。
        // --------------------------------------------
        const target = lookAtTargetRef.current
        if (target && vrm.lookAt) {
          _tmpCamDir.subVectors(controls.target, camera.position).normalize()
          _tmpCamRight.crossVectors(_tmpCamDir, camera.up).normalize()
          _tmpCamUp.crossVectors(_tmpCamRight, _tmpCamDir).normalize()

          // AI 指令的视线覆盖优先：「看镜头」直接锁定相机位置，
          // 「正视前方」等价于鼠标偏移归零；只有 cursor/未指定时才跟随鼠标
          const lookOverride = lookAtOverrideRef.current
          const followCursor = (!lookOverride || lookOverride === 'cursor') && lookAtEnabledRef.current

          const smooth = pointerSmoothRef.current
          const raw = followCursor ? (pointerRef?.current ?? { x: 0, y: 0 }) : { x: 0, y: 0 }
          // 一阶低通平滑：避免鼠标抖动导致眼睛乱转；关闭跟随时平滑回到正前方
          smooth.x += (raw.x - smooth.x) * 0.12
          smooth.y += (raw.y - smooth.y) * 0.12

          if (lookOverride === 'camera') {
            // 看向镜头：直接以相机世界坐标为视线目标
            target.position.copy(camera.position)
          } else {
            head?.getWorldPosition(_tmpHeadPos)
            // 模型没有 head 骨骼时退化为以髋部为参考
            if (!head) {
              humanoid?.getNormalizedBoneNode('hips')?.getWorldPosition(_tmpHeadPos)
              _tmpHeadPos.y += 0.8
            }
            // 前向偏移固定在模型正前方（+Z，VRM 面向 +Z）
            _tmpLookAtPos.set(_tmpHeadPos.x, _tmpHeadPos.y, _tmpHeadPos.z + 1.4)
            _tmpLookAtPos.addScaledVector(_tmpCamRight, smooth.x * 0.9)
            _tmpLookAtPos.addScaledVector(_tmpCamUp, -smooth.y * 0.6)
            target.position.copy(_tmpLookAtPos)
          }
          target.updateMatrixWorld()
        }

        // --------------------------------------------
        // 3. 表情：眨眼 + 口型（必须在 vrm.update() 之前写入才会当帧生效）
        // --------------------------------------------
        const expressions = vrm.expressionManager
        if (expressions) {
          if (now > nextBlinkAt && blinkUntil === 0) {
            blinkUntil = now + 110
            nextBlinkAt = now + 2200 + Math.random() * 3600
          }
          if (blinkUntil > 0) {
            if (now < blinkUntil) {
              expressions.setValue('blink', 1)
            } else {
              expressions.setValue('blink', 0)
              blinkUntil = 0
            }
          }

          const mouth = mouthOpenRef.current
          expressions.setValue('aa', Math.max(0, Math.min(1, mouth)))

          // --------------------------------------------
          // 3b. 情绪表情覆盖（AI 指令 / 交互触发）
          //
          // 到期后把上一次写入的表情归零 —— 只置 null 不清零的话，
          // 表情会永久停在最后一帧（VRM 表情是累加的，没有「自动回弹」）。
          // --------------------------------------------
          const override = expressionOverrideRef.current
          const applied = appliedExpressionRef.current

          if (override && (override.until === 0 || now < override.until)) {
            if (applied && applied !== override.name) expressions.setValue(applied, 0)
            expressions.setValue(override.name, override.weight)
            appliedExpressionRef.current = override.name
          } else {
            if (override) expressionOverrideRef.current = null
            if (applied) {
              expressions.setValue(applied, 0)
              appliedExpressionRef.current = null
            }
          }
        }

        // --------------------------------------------
        // 4. VRM 内部更新：归一化→raw 传导、lookAt、表情、SpringBone
        // --------------------------------------------
        vrm.update(delta)

        // --------------------------------------------
        // 5. 悬停检测：节流做射线检测，判断指针是否压在角色上
        //
        // 两条消费路径：
        // - onPointerOverChange：即时上报，上层据此浮出操作栏、并让窗口按需接管鼠标事件
        //   （桌面伴侣默认鼠标穿透，这条路径是「穿透状态下仍能操作」的关键）
        // - autoHide：悬停确认后淡出画布并让开点击
        //
        // 指针不在窗口内时直接判定「未悬停」：此时 pointerRef 是过期坐标，
        // 若继续沿用它，指针离开窗口后角色会一直处于悬停态 ——
        // 表现为操作栏不消失、窗口永久接管鼠标事件（桌面点不动）。
        // --------------------------------------------
        if (now - hoverCheckAtRef.current >= HOVER_CHECK_INTERVAL) {
          hoverCheckAtRef.current = now
          const pointerInside = pointerInsideRef?.current !== false
          const raw =
            pointerInside && pointerRef ? pointerRef.current : { x: 0, y: 0 }
          _tmpNdc.set(raw.x, -raw.y)
          raycasterRef.current.setFromCamera(_tmpNdc, camera)
          // 指针在窗口外时跳过射线检测（intersectObject 开销不低，且结果必然无效）
          const hit =
            pointerInside && raycasterRef.current.intersectObject(vrm.scene, true).length > 0
          // 拖拽旋转期间不隐藏：否则刚抓住角色就淡出 + 穿透，视角根本转不动
          const hovering = hit && !orbitDraggingRef.current

          // 指针重新进入窗口时强制重报一次：上层在「指针离开」时可能已把悬停态重置为 false，
          // 而本组件的上一次结果恰好也是 true 时不会触发回调 —— 不重报就会出现
          // 「指针明明压在角色上，操作栏却不出现」。
          const reentered = pointerInside && !pointerInsideSeenRef.current
          pointerInsideSeenRef.current = pointerInside

          // 上报悬停态（仅在变化时回调，避免每帧触发上层 setState）
          if (reentered || hovering !== pointerOverRef.current) {
            pointerOverRef.current = hovering
            onPointerOverChangeRef.current?.(hovering)
          }

          if (autoHideRef.current) {
            if (!hovering) hoverSinceRef.current = 0
            else if (hoverSinceRef.current === 0) hoverSinceRef.current = now

            // 悬停需持续 AUTO_HIDE_HOVER_DELAY 才真正隐藏。
            // 这个「延时确认」同时给旋转视角留出时间窗：鼠标扫过角色后立刻按下拖拽，
            // 此时隐藏尚未生效（窗口仍在接收事件），拖拽一开始就不会再隐藏。
            const settled = hovering && now - hoverSinceRef.current >= AUTO_HIDE_HOVER_DELAY
            if (settled !== hoverHiddenRef.current) {
              hoverHiddenRef.current = settled
              setCanvasHidden(renderer, settled)
              // 穿透期间收不到指针事件，控制器会卡在半激活状态，直接禁用
              controls.enabled = !settled
              onHoverChangeRef.current?.(settled)
            }
          }
        }

        if (!autoHideRef.current && hoverHiddenRef.current) {
          // 运行中关闭开关：立即恢复显示并解除穿透
          hoverHiddenRef.current = false
          hoverSinceRef.current = 0
          setCanvasHidden(renderer, false)
          controls.enabled = true
          onHoverChangeRef.current?.(false)
        }


      }

      // 环绕阻尼：松手后继续惯性滑行，必须逐帧推进（无拖拽时开销极小）
      controls.update()

      renderer.render(scene, camera)
    }

    rafId = requestAnimationFrame(animate)

    // --------------------------------------------
    // 尺寸自适应
    // --------------------------------------------
    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      // 比例变化会改变横向取景能力：重新取景，避免窗口变窄后角色两侧被裁
      applyFramingRef.current()
    })
    resizeObserver.observe(container)

    // --------------------------------------------
    // 清理
    // --------------------------------------------
    return () => {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()

      // 画布可能停在「自动隐藏」的透明态：恢复不透明度并复位穿透状态，
      // 否则窗口会保留鼠标穿透，导致卸载后所有点击失效
      if (hoverHiddenRef.current) {
        hoverHiddenRef.current = false
        setCanvasHidden(renderer, false)
        onHoverChangeRef.current?.(false)
      }

      // 环绕控制器先解绑：它监听 renderer.domElement 的指针事件，
      // 不 dispose 会在重挂载后残留旧监听（引用已销毁的相机）
      controls.removeEventListener('start', handleControlsStart)
      controls.removeEventListener('end', handleControlsEnd)
      controls.dispose()
      orbitDraggingRef.current = false
      hoverSinceRef.current = 0

      // Mixer 先停：它持有对骨骼节点的绑定，必须在销毁模型之前释放
      idleControllerRef.current?.dispose()
      idleControllerRef.current = null

      const currentVrm = vrmRef.current
      if (currentVrm) {
        scene.remove(currentVrm.scene)
        try {
          VRMUtils.deepDispose(currentVrm.scene)
        } catch {
          /* 忽略清理异常 */
        }
        vrmRef.current = null
      }

      renderer.dispose()
      renderer.forceContextLoss()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      loadedUrlRef.current = null
      lookAtTargetRef.current = null
    }
    // mouthOpenRef 为 ref，不参与依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --------------------------------------------
  // 开关同步（渲染循环逐帧读取 ref，无需重跑场景初始化）
  // --------------------------------------------
  useEffect(() => {
    idleEnabledRef.current = idleEnabled
    idleControllerRef.current?.setEnabled(idleEnabled)
  }, [idleEnabled])

  useEffect(() => {
    lookAtEnabledRef.current = lookAtEnabled
  }, [lookAtEnabled])

  // 动作列表刷新（上层异步拉取完成后变化）：即刻应用到当前角色，无需等下次切模型
  useEffect(() => {
    animationUrlsRef.current = animationUrls ?? []
    const controller = idleControllerRef.current
    if (!controller || animationUrlsRef.current.length === 0) return
    void controller.loadAnimations(animationUrlsRef.current).catch((err) => {
      logger.system.warn('[VrmStage] Animation reload failed (ignored):', err)
    })
  }, [animationUrls])

  // 自动隐藏开关 / 回调同步（渲染循环逐帧读取 ref，无需重跑场景初始化）
  useEffect(() => {
    autoHideRef.current = autoHide
  }, [autoHide])

  useEffect(() => {
    onHoverChangeRef.current = onHoverChange
  }, [onHoverChange])

  useEffect(() => {
    onPointerOverChangeRef.current = onPointerOverChange
  }, [onPointerOverChange])


  // --------------------------------------------
  // 模型加载 / 切换
  // --------------------------------------------
  useEffect(() => {
    const loader = loaderRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current
    if (!loader || !scene || !camera) return

    // 未指定模型：清空当前角色
    if (!modelUrl) {
      const old = vrmRef.current
      if (old) {
        idleControllerRef.current?.dispose()
        idleControllerRef.current = null
        scene.remove(old.scene)
        try {
          VRMUtils.deepDispose(old.scene)
        } catch {
          /* 忽略 */
        }
        vrmRef.current = null
        loadedUrlRef.current = null
      }
      return
    }

    // 同一模型不重复加载
    if (loadedUrlRef.current === modelUrl && vrmRef.current) return

    let cancelled = false
    loadedUrlRef.current = modelUrl

    loader.load(
      modelUrl,
      (gltf) => {
        if (cancelled) return

        const vrm = gltf.userData.vrm as VRM | undefined
        if (!vrm) {
          const msg = '模型缺少 VRM 数据（可能不是有效的 VRM 文件）'
          logger.system.warn('[VrmStage]', msg)
          onError?.(msg)
          loadedUrlRef.current = null
          return
        }

        // 移除旧模型（先释放它持有的 Mixer，再销毁场景）
        const old = vrmRef.current
        if (old && old !== vrm) {
          idleControllerRef.current?.dispose()
          idleControllerRef.current = null
          scene.remove(old.scene)
          try {
            VRMUtils.deepDispose(old.scene)
          } catch {
            /* 忽略 */
          }
        }

        // VRM 0.x 需要旋转 180°（面向 +Z）
        try {
          if (vrm.meta?.metaVersion === '0') {
            VRMUtils.rotateVRM0(vrm)
          }
          // 性能优化：合并骨架 / 移除冗余顶点
          VRMUtils.removeUnnecessaryVertices(gltf.scene)
          VRMUtils.combineSkeletons(gltf.scene)
        } catch (err) {
          logger.system.warn('[VrmStage] Optimize failed (ignored):', err)
        }

        // 关闭视锥剔除，避免骨骼动画导致整体被剔除；
        // 同时修正透明材质的 alpha 合成（对齐 example/super-ai-browser 的材质修复）。
        //
        // 为什么必须修正：VRM 的头发 / 睫毛 / 服装大量使用 alpha 混合。
        // 打包安装后（Electron 透明窗口 + GPU 合成路径）若沿用引擎默认的混合设置，
        // 半透明像素会被重复预乘 / 叠加，整个角色发白并失去色彩 ——
        // 表现为「像底片一样的白色剪影」，而 npm run dev 下该问题不显现。
        vrm.scene.traverse((obj) => {
          obj.frustumCulled = false

          const mesh = obj as THREE.Mesh
          if (!mesh.isMesh || !mesh.material) return

          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const material of materials) {
            // 透明材质：用极小 alphaTest 剔除全透明像素，并写深度，避免排序叠加导致的透光发白
            if (material.transparent) {
              material.alphaTest = 0.01
              material.depthWrite = true
            }
            // 统一为普通混合：MToon 若落到叠加类混合会让重叠区域过曝、整体失去色彩
            material.blending = THREE.NormalBlending
            // 与透明窗口的合成约定保持一致（非预乘），避免 alpha 被重复预乘导致颜色爆白
            material.premultipliedAlpha = false
            material.needsUpdate = true
          }

          // 渲染顺序：不透明先画、透明后画
          mesh.renderOrder = materials[0]?.transparent ? 1 : 0
        })

        scene.add(vrm.scene)
        vrmRef.current = vrm

        // 调试钩子：供内部分析脚本 / 自动化探针读取渲染器与材质的真实状态。
        // 生产态同样保留（只读引用，无副作用），用于排查「打包后画面发白」
        // 这类只在 file:// + GPU 合成路径下才出现的问题。
        try {
          ;(window as unknown as Record<string, unknown>).__AWEE_VRM_DEBUG__ = {
            renderer: rendererRef.current,
            scene,
            camera: cameraRef.current,
            vrm,
          }
        } catch {
          /* 忽略：调试钩子不得影响渲染 */
        }

        // 视线跟随：把 lookAt 目标指向场景中的空对象，交由 VRM 自动驱动眼/头
        try {
          if (vrm.lookAt && lookAtTargetRef.current) {
            vrm.lookAt.target = lookAtTargetRef.current
            vrm.lookAt.autoUpdate = true
          }
        } catch (err) {
          logger.system.warn('[VrmStage] lookAt setup failed (ignored):', err)
        }

        // 待机动作：自然站姿 + 程序化 idle + 呼吸，统一交给 AnimationMixer 驱动。
        // 先释放上一实例，避免切换模型时旧的 Mixer 仍在写骨骼。
        idleControllerRef.current?.dispose()
        const idleController = new VrmIdleController(vrm)
        idleController.setEnabled(idleEnabledRef.current)
        idleControllerRef.current = idleController

        // VRMA 动作（异步）：clip 与具体模型骨架绑定，因此每次切换模型都要重新加载。
        // 不 await：动作到位前先以程序化站姿呈现，到位后由控制器自动接管动作队列。
        const urls = animationUrlsRef.current
        if (urls.length > 0) {
          void idleController
            .loadAnimations(urls)
            .then(() => {
              // 加载期间可能已切换模型，此时 controller 已 dispose，无需上报
              if (idleControllerRef.current !== idleController) return
              logger.system.info('[VrmStage] Animations ready', {
                count: idleController.animationCount,
              })
            })
            .catch((err) => {
              logger.system.warn('[VrmStage] Animation load failed (ignored):', err)
            })
        }

        // 按模型实际高度 + 当前缩放 + 窗口比例适配相机取景（上半身构图，放大不裁头）
        applyFramingRef.current()

        logger.system.info('[VrmStage] Model loaded', {
          scale: scaleRef.current,
        })
        onReady?.()
      },
      undefined,
      (err) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        logger.system.warn('[VrmStage] Load failed:', msg)
        loadedUrlRef.current = null
        onError?.(msg)
      },
    )

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl])

  // --------------------------------------------
  // 缩放（调整相机距离，等效于角色放大/缩小）
  // --------------------------------------------
  useEffect(() => {
    scaleRef.current = scale
    // 距离/取景中心由 applyFramingRef 依据当前模型 + 窗口比例重算，
    // 同时保留用户已经转到的环绕角度
    applyFramingRef.current()
  }, [scale, modelUrl])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
})
