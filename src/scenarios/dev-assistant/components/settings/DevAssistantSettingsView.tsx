/**
 * 开发助手设置面板视图
 * 作为 wideMode 面板嵌入到开发助手场景主内容区
 */

import { useCallback } from 'react'
import { useStore } from '@store'
import { DevAssistantSettingsDialog } from './index'

export default function DevAssistantSettingsView() {
    const closePanel = useCallback(() => {
        useStore.getState().setActiveSidePanel('explorer')
    }, [])

    return <DevAssistantSettingsDialog embedded onClose={closePanel} />
}