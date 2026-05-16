import type { WorkMode } from '@protocols/workModeProtocol'

export type { WorkMode } from '@protocols/workModeProtocol'

export interface ModeConfig {
    id: WorkMode
    label: string
    icon: string
    description: string
}

export const MODE_CONFIGS: Record<WorkMode, ModeConfig> = {
    chat: {
        id: 'chat',
        label: 'Quick',
        icon: 'Zap',
        description: '适用于大部分情况'
    },
    agent: {
        id: 'agent',
        label: 'Think',
        icon: 'Brain',
        description: '擅长解决更难的问题'
    },
    plan: {
        id: 'plan',
        label: 'Expert',
        icon: 'GraduationCap',
        description: '研究级智能模式'
    }
}
