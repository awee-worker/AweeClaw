/**
 * 全局浮层/弹窗组件
 *
 * 将 AweeApp.tsx 中分散的全局弹窗（命令面板、快捷键、文件导航、引导向导等）
 * 集中到一个组件中管理，降低 AweeApp 的复杂度。
 */

import { Suspense, lazy, useCallback } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'

const CommandHub = lazy(() => import('@components/modals/CommandHub'))
const ShortcutReference = lazy(() => import('@components/modals/ShortcutReference'))
const FileNavigator = lazy(() => import('@components/modals/FileNavigator'))
const OnboardingWizard = lazy(() => import('@scenarios/dev-assistant/components/OnboardingWizard'))
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

  const handleCloseOnboarding = useCallback(() => {
    setShowOnboarding(false)
  }, [setShowOnboarding])

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
      {showOnboarding && isInitialized && (
        <Suspense fallback={null}>
          <OnboardingWizard onComplete={handleCloseOnboarding} />
        </Suspense>
      )}
      {showAbout && (
        <Suspense fallback={null}>
          <AppIdentityPanel onClose={() => setShowAbout(false)} />
        </Suspense>
      )}
    </>
  )
}
