/**
 * 配置清洗器 - securitySettings 透传回归测试
 *
 * 背景：cleanAppSettings 逐字段复制时会丢弃未在 AppSettingsSchema 中声明的字段。
 * securitySettings 采用开放结构（allowedExternalDirectories 等扩展字段），
 * 一旦被清洗掉，随 app-settings 持久化的那份配置就会丢失外部允许目录，
 * 表现为「安全设置里配置了工作区外目录，AI 仍报 Path is outside workspace」。
 */

import { describe, it, expect } from 'vitest'
import { cleanAppSettings, cleanConfigValue } from '@shared/configuration/configSanitizer'

const EXTERNAL_DIR = '/Volumes/MacData/Customers/Application/depuapp/depu-boot'

const securitySettings = {
    enablePermissionConfirm: false,
    strictWorkspaceMode: true,
    showSecurityWarnings: true,
    allowedShellCommands: ['ls'],
    allowedExternalDirectories: [EXTERNAL_DIR],
}

describe('cleanAppSettings - securitySettings 透传', () => {
    it('保留 securitySettings 及其扩展字段（allowedExternalDirectories）', () => {
        const cleaned = cleanAppSettings({ securitySettings })

        expect(cleaned.securitySettings).toBeDefined()
        expect(
            (cleaned.securitySettings as Record<string, unknown>).allowedExternalDirectories,
        ).toEqual([EXTERNAL_DIR])
        // 已知字段同样不能丢
        expect((cleaned.securitySettings as Record<string, unknown>).strictWorkspaceMode).toBe(true)
    })

    it('保留 privacySettings 与 editorConfig', () => {
        const cleaned = cleanAppSettings({
            privacySettings: { telemetryEnabled: false },
            editorConfig: { fontSize: 14, minimap: false },
        })

        expect(cleaned.privacySettings).toEqual({ telemetryEnabled: false })
        expect(cleaned.editorConfig).toEqual({ fontSize: 14, minimap: false })
    })

    it('字段缺失或类型非法时不下发该字段', () => {
        const cleaned = cleanAppSettings({ securitySettings: 'not-an-object' })
        expect(cleaned.securitySettings).toBeUndefined()
    })

    it('cleanConfigValue("app-settings") 全链路不丢外部允许目录', () => {
        const cleaned = cleanConfigValue('app-settings', {
            language: 'zh',
            securitySettings,
        }) as Record<string, any>

        expect(cleaned.securitySettings.allowedExternalDirectories).toEqual([EXTERNAL_DIR])
    })

    it('cleanConfigValue("securitySettings") 原样保留', () => {
        const cleaned = cleanConfigValue('securitySettings', securitySettings) as Record<string, any>
        expect(cleaned.allowedExternalDirectories).toEqual([EXTERNAL_DIR])
    })
})
