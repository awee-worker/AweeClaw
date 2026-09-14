/**
 * 临时调试入口：在浏览器中挂载 VrmStage，用于验证 VRM 渲染与待机动作。
 * 仅用于本地排查，不属于产品代码。
 */
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { VrmStage } from './components/vrm-companion/VrmStage'

const params = new URLSearchParams(location.search)
const model = params.get('model') || '/__vrm__/models/Alice.vrm'
const scale = Number(params.get('scale') || '0.5')
const idle = params.get('idle') !== '0'
const lookAt = params.get('look') === '1'
const autoHide = params.get('autohide') === '1'


/** 与产品侧一致：这些动作幅度过大，不进待机队列（见 VrmCompanionApp 的注释） */
const NON_IDLE_FILES = new Set(['spin.vrma', 'squat.vrma', 'show_full_body.vrma', 'shoot.vrma'])

function Test() {
  const mouthRef = useRef(0)
  const pointerRef = useRef({ x: 0, y: 0 })
  const [animationUrls, setAnimationUrls] = useState<string[]>([])

  // 调试页直接读 Vite 中间件暴露的动作目录，复现「VRMA 待机队列」
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/__vrm__/animations?list=1')
        const files = (await res.json()) as string[]
        setAnimationUrls(
          files.filter((f) => !NON_IDLE_FILES.has(f)).map((f) => `/__vrm__/animations/${f}`),
        )
      } catch {
        /* 无动作时退回纯程序化待机 */
      }
    })()
  }, [])

  // 复现产品侧的鼠标位置更新（驱动视线跟随 + 自动隐藏的射线检测）
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      pointerRef.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: (e.clientY / window.innerHeight) * 2 - 1,
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])


  return (
    <div style={{ width: '100%', height: '100%' }}>
      <VrmStage
        modelUrl={model}
        scale={scale}
        mouthOpenRef={mouthRef}
        idleEnabled={idle}
        lookAtEnabled={lookAt}
        pointerRef={pointerRef}
        animationUrls={animationUrls}
        autoHide={autoHide}

        onReady={() => {
          ;(window as unknown as Record<string, unknown>).__vrmReady = true
        }}
        onError={(m) => {
          ;(window as unknown as Record<string, unknown>).__vrmError = m
        }}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Test />)
