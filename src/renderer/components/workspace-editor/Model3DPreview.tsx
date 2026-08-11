/**
 * 3D 模型预览组件
 *
 * 基于 @react-three/fiber + @react-three/drei 实现，支持加载 GLB/GLTF 格式的 3D 模型。
 *
 * 功能：
 * - 自动加载 GLB/GLTF 文件（支持 Draco 压缩）
 * - 鼠标拖拽旋转、滚轮缩放、右键平移
 * - 工具栏：线框模式 / 自动旋转 / 重置视角 / 全屏
 * - 加载进度显示
 * - 暗色/亮色主题适配
 * - 错误处理（文件不存在、格式不支持等）
 *
 * 文件加载流程：
 * 1. 通过 api.file.readBinary 读取本地文件为 ArrayBuffer
 * 2. 创建 Blob URL 供 useGLTF 加载
 * 3. 加载完成后自动计算包围盒，调整相机位置
 *
 * 参考：
 * - FilePreviewPanel.tsx 的 VideoPreview 组件（错误处理、加载状态模式）
 * - Memory3DScene.tsx 的 Canvas 配置（camera、lighting、OrbitControls）
 */

import { useState, useCallback, useEffect, useRef, useMemo, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment, ContactShadows, Bounds, useProgress, Html } from '@react-three/drei'
import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import {
  AlertTriangle,
  RotateCcw,
  Maximize2,
  Minimize2,
  Grid3x3,
  Play,
  Pause,
  Loader2,
  ExternalLink,
} from 'lucide-react'
import { ActionButton } from '../ui'

// ===== 组件 Props =====

interface Model3DPreviewProps {
  /** 3D 模型文件的本地绝对路径 */
  path: string
}

// ===== 内部状态 =====

type LoadState = 'loading' | 'success' | 'error'

// ===== 主组件 =====

export function Model3DPreview({ path }: Model3DPreviewProps) {
  const language = useStore(s => s.language)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [modelUrl, setModelUrl] = useState<string | null>(null)
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const orbitControlsRef = useRef<any>(null)

  // 加载文件为 Blob URL
  useEffect(() => {
    let cancelled = false
    let blobUrl: string | null = null

    const loadFile = async () => {
      setLoadState('loading')
      setErrorMsg('')
      setModelUrl(null)

      try {
        // 检查文件是否存在
        const exists = await api.file.exists(path)
        if (cancelled) return
        if (!exists) {
          logger.file.error(`[Model3DPreview] File not found: ${path}`)
          setErrorMsg(language === 'zh' ? '文件不存在' : 'File not found')
          setLoadState('error')
          return
        }

        // 读取文件为 ArrayBuffer
        const arrayBuffer = await api.file.readBinary(path)
        if (cancelled) return

        if (!arrayBuffer || typeof arrayBuffer !== 'string') {
          setErrorMsg(language === 'zh' ? '无法读取文件内容' : 'Unable to read file content')
          setLoadState('error')
          return
        }

        // 将 base64 转为 ArrayBuffer
        const binaryString = atob(arrayBuffer)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }

        // 检测 MIME 类型
        const ext = path.split('.').pop()?.toLowerCase() || 'glb'
        const mimeType = ext === 'gltf' ? 'model/gltf+json' : 'model/gltf-binary'

        // 创建 Blob URL
        const blob = new Blob([bytes], { type: mimeType })
        blobUrl = URL.createObjectURL(blob)

        if (cancelled) return
        setModelUrl(blobUrl)
        // useGLTF 会自动加载，加载状态由 <ModelLoader> 内部处理
        logger.file.info(`[Model3DPreview] Model loaded: ${path} (${bytes.length} bytes)`)
      } catch (e) {
        if (cancelled) return
        logger.file.error('[Model3DPreview] Failed to load model:', e)
        setErrorMsg(language === 'zh' ? `加载失败: ${(e as Error).message}` : `Load failed: ${(e as Error).message}`)
        setLoadState('error')
      }
    }

    loadFile()

    return () => {
      cancelled = true
      // 释放 Blob URL 避免内存泄漏
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
      // 清除 useGLTF 缓存
      try {
        useGLTF.clear(path)
      } catch {
        // 忽略缓存清除错误
      }
    }
  }, [path, language])

  // 重置视角
  const handleResetView = useCallback(() => {
    if (orbitControlsRef.current) {
      orbitControlsRef.current.reset()
    }
  }, [])

  // 切换全屏
  const handleToggleFullscreen = useCallback(() => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen?.()
      setIsFullscreen(false)
    }
  }, [])

  // 监听全屏变化
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [])

  // 使用系统默认程序打开
  const handleOpenExternal = useCallback(async () => {
    try {
      await api.desktop.openFile(path)
    } catch (e) {
      logger.file.error('[Model3DPreview] Failed to open with default app:', e)
    }
  }, [path])

  // 错误状态
  if (loadState === 'error') {
    return (
      <div className="h-full flex items-center justify-center bg-background-editor">
        <div className="text-center p-8">
          <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">
            {t('filePreview.cannotLoadModel', language)}
          </h3>
          <p className="text-sm text-text-muted mb-4">{errorMsg}</p>
          <p className="text-xs text-text-muted mb-6 font-mono break-all">{path}</p>
          <ActionButton variant="secondary" onClick={handleOpenExternal} className="gap-2">
            <ExternalLink className="w-4 h-4" />
            {t('filePreview.openWithDefault', language)}
          </ActionButton>
        </div>
      </div>
    )
  }

  // 加载中 / 成功状态
  return (
    <div
      ref={containerRef}
      className="h-full w-full relative bg-background-editor"
    >
      {/* 3D Canvas */}
      {modelUrl && (
        <Canvas
          camera={{ position: [3, 2, 5], fov: 50, near: 0.1, far: 1000 }}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
          dpr={[1, 2]}
          shadows
          style={{ width: '100%', height: '100%' }}
        >
          <Suspense fallback={<LoadingFallback language={language} />}>
            {/* 光照 */}
            <ambientLight intensity={0.6} />
            <directionalLight
              position={[5, 8, 5]}
              intensity={1.2}
              castShadow
              shadow-mapSize-width={2048}
              shadow-mapSize-height={2048}
              shadow-camera-far={50}
              shadow-camera-left={-10}
              shadow-camera-right={10}
              shadow-camera-top={10}
              shadow-camera-bottom={-10}
            />
            <directionalLight position={[-5, 3, -5]} intensity={0.4} />

            {/* 环境光照（提供反射，让 PBR 材质更真实） */}
            <Environment preset="studio" background={false} />

            {/* 3D 模型 */}
            <Bounds fit clip observe margin={1.2}>
              <ModelScene url={modelUrl} wireframe={wireframe} onLoad={() => setLoadState('success')} />
            </Bounds>

            {/* 接触阴影 */}
            <ContactShadows
              position={[0, -1.5, 0]}
              opacity={0.5}
              scale={20}
              blur={2}
              far={4}
              resolution={1024}
              color="#000000"
            />

            {/* 相机控制 */}
            <OrbitControls
              ref={orbitControlsRef}
              makeDefault
              enableDamping
              dampingFactor={0.08}
              minDistance={0.5}
              maxDistance={100}
              autoRotate={autoRotate}
              autoRotateSpeed={1.0}
            />
          </Suspense>
        </Canvas>
      )}

      {/* 加载状态遮罩 */}
      {loadState === 'loading' && <LoadingOverlay language={language} />}

      {/* 工具栏 */}
      {loadState === 'success' && (
        <ModelToolbar
          wireframe={wireframe}
          autoRotate={autoRotate}
          isFullscreen={isFullscreen}
          onToggleWireframe={() => setWireframe(v => !v)}
          onToggleAutoRotate={() => setAutoRotate(v => !v)}
          onResetView={handleResetView}
          onToggleFullscreen={handleToggleFullscreen}
          onOpenExternal={handleOpenExternal}
          language={language}
        />
      )}
    </div>
  )
}

// ===== 3D 模型场景组件 =====

interface ModelSceneProps {
  url: string
  wireframe: boolean
  onLoad?: () => void
}

/**
 * 加载并渲染 3D 模型
 *
 * 使用 useGLTF 加载 GLB/GLTF 文件，支持 Draco 压缩。
 * 加载完成后遍历所有 Mesh 设置 wireframe 材质属性。
 */
function ModelScene({ url, wireframe, onLoad }: ModelSceneProps) {
  const gltf = useGLTF(url)

  // 克隆场景避免修改原始缓存
  const scene = useMemo(() => {
    const cloned = gltf.scene.clone(true)
    cloned.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
        // 保存原始材质引用，便于 wireframe 切换
        if (!child.userData._originalMaterial) {
          child.userData._originalMaterial = child.material
        }
      }
    })
    return cloned
  }, [gltf])

  // 切换线框模式
  useEffect(() => {
    scene.traverse((child: any) => {
      if (child.isMesh) {
        const mat = child.material
        if (Array.isArray(mat)) {
          mat.forEach((m: any) => {
            if (m) m.wireframe = wireframe
          })
        } else if (mat) {
          mat.wireframe = wireframe
        }
      }
    })
  }, [scene, wireframe])

  // 加载完成回调
  useEffect(() => {
    onLoad?.()
  }, [onLoad])

  return <primitive object={scene} />
}

// 预加载（避免首次加载卡顿）
useGLTF.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')

// ===== 加载状态组件 =====

interface LoadingFallbackProps {
  language: string
}

function LoadingFallback({ language }: LoadingFallbackProps) {
  const { progress, active } = useProgress()
  return (
    <Html center>
      <div className="flex flex-col items-center gap-2 text-text-primary">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
        <div className="text-sm">
          {language === 'zh' ? '加载 3D 模型...' : 'Loading 3D model...'}
        </div>
        {active && progress > 0 && (
          <div className="text-xs text-text-muted">
            {progress.toFixed(0)}%
          </div>
        )}
      </div>
    </Html>
  )
}

interface LoadingOverlayProps {
  language: string
}

function LoadingOverlay({ language }: LoadingOverlayProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background-editor/80 backdrop-blur-sm z-10">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-10 h-10 animate-spin text-accent" />
        <div className="text-sm text-text-muted">
          {language === 'zh' ? '正在加载 3D 模型...' : 'Loading 3D model...'}
        </div>
      </div>
    </div>
  )
}

// ===== 工具栏组件 =====

interface ModelToolbarProps {
  wireframe: boolean
  autoRotate: boolean
  isFullscreen: boolean
  onToggleWireframe: () => void
  onToggleAutoRotate: () => void
  onResetView: () => void
  onToggleFullscreen: () => void
  onOpenExternal: () => void
  language: string
}

function ModelToolbar({
  wireframe,
  autoRotate,
  isFullscreen,
  onToggleWireframe,
  onToggleAutoRotate,
  onResetView,
  onToggleFullscreen,
  onOpenExternal,
  language,
}: ModelToolbarProps) {
  return (
    <div className="absolute top-3 right-3 z-20 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-surface/80 backdrop-blur-md border border-border shadow-lg">
      {/* 线框模式 */}
      <ToolbarButton
        active={wireframe}
        onClick={onToggleWireframe}
        title={language === 'zh' ? '线框模式' : 'Wireframe'}
      >
        <Grid3x3 className="w-4 h-4" />
      </ToolbarButton>

      {/* 自动旋转 */}
      <ToolbarButton
        active={autoRotate}
        onClick={onToggleAutoRotate}
        title={language === 'zh' ? '自动旋转' : 'Auto Rotate'}
      >
        {autoRotate ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </ToolbarButton>

      {/* 分隔线 */}
      <div className="w-px h-5 bg-border mx-1" />

      {/* 重置视角 */}
      <ToolbarButton
        onClick={onResetView}
        title={language === 'zh' ? '重置视角' : 'Reset View'}
      >
        <RotateCcw className="w-4 h-4" />
      </ToolbarButton>

      {/* 全屏 */}
      <ToolbarButton
        onClick={onToggleFullscreen}
        title={language === 'zh' ? (isFullscreen ? '退出全屏' : '全屏') : (isFullscreen ? 'Exit Fullscreen' : 'Fullscreen')}
      >
        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </ToolbarButton>

      {/* 分隔线 */}
      <div className="w-px h-5 bg-border mx-1" />

      {/* 使用默认程序打开 */}
      <ToolbarButton
        onClick={onOpenExternal}
        title={language === 'zh' ? '使用默认程序打开' : 'Open with Default App'}
      >
        <ExternalLink className="w-4 h-4" />
      </ToolbarButton>
    </div>
  )
}

interface ToolbarButtonProps {
  children: React.ReactNode
  onClick: () => void
  title: string
  active?: boolean
}

function ToolbarButton({ children, onClick, title, active }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? 'bg-accent/20 text-accent'
          : 'text-text-muted hover:text-text-primary hover:bg-surface'
      }`}
    >
      {children}
    </button>
  )
}
