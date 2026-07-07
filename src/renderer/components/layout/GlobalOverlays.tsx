/**
 * 全局浮层/弹窗组件
 *
 * 将 AweeApp.tsx 中分散的全局弹窗（命令面板、快捷键、文件导航、引导向导等）
 * 集中到一个组件中管理，降低 AweeApp 的复杂度。
 *
 * 注意：引导向导（OnboardingWizard）通过场景系统动态获取，
 * dev-assistant 场景被删除时不渲染，不影响应用启动。
 */

import { Suspense, lazy } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { getScenarioComponent } from '@components/scenario/ScenarioComponentResolver'

const CommandHub = lazy(() => import('@components/modals/CommandHub'))
const ShortcutReference = lazy(() => import('@components/modals/ShortcutReference'))
const FileNavigator = lazy(() => import('@components/modals/FileNavigator'))
const AppIdentityPanel = lazy(() => import('@components/modals/AppIdentityPanel'))

interface GlobalOverlaysProps {
  showKeyboardShortcuts: boolean
  setShowKeyboardShortcuts: (v: boolean) => void
  showOnboarding: boolean
  setShowOnboarding: (v: boolean) => void
  isInitialized: boolean
}

export default function GlobalOverlays({
  showKeyboardShortcuts,
  setShowKeyboardShortcuts,
  showOnboarding,
  setShowOnboarding,
  isInitialized,
}: GlobalOverlaysProps) {
  const { showCommandPalette, setShowCommandPalette, showQuickOpen, setShowQuickOpen, showAbout, setShowAbout } =
    useStore(useShallow((s) => ({
      showCommandPalette: s.showCommandPalette,
      setShowCommandPalette: s.setShowCommandPalette,
      showQuickOpen: s.showQuickOpen,
      setShowQuickOpen: s.setShowQuickOpen,
      showAbout: s.showAbout,
      setShowAbout: s.setShowAbout,
    })))

  // 动态解析引导向导组件：dev-assistant 场景被删除时返回 undefined
  const OnboardingWizard = getScenarioComponent('dev-assistant', 'OnboardingWizard')

  return (
    <>
      {showCommandPalette && (
        <Suspense fallback={null}>
          <CommandHub
            onClose={() => setShowCommandPalette(false)}
            onShowKeyboardShortcuts={() => {
              setShowCommandPalette(false)
              setShowKeyboardShortcuts(true)
            }}
          />
        </Suspense>
      )}
      {showKeyboardShortcuts && (
        <Suspense fallback={null}>
          <ShortcutReference onClose={() => setShowKeyboardShortcuts(false)} />
        </Suspense>
      )}
      {showQuickOpen && (
        <Suspense fallback={null}>
          <FileNavigator onClose={() => setShowQuickOpen(false)} />
        </Suspense>
      )}

      {showAbout && (
        <Suspense fallback={null}>
          <AppIdentityPanel onClose={() => setShowAbout(false)} />
        </Suspense>
      )}
      {/* 首次使用引导向导：仅在初始化完成、需要展示、且场景组件可用时渲染 */}
      {isInitialized && showOnboarding && OnboardingWizard && (
        <Suspense fallback={null}>
          <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
        </Suspense>
      )}
    </>
  )
}
