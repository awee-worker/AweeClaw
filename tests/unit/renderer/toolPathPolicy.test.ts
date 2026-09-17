/**
 * 工具路径放行策略单元测试
 *
 * 回归保护：用户在「设置 → 安全设置 → 工作区外允许访问的目录」中配置的目录
 * 必须被纳入工具执行前的路径放行列表，否则 AI 访问该目录会报
 * "Security: Path is outside workspace"。
 */

import { describe, it, expect } from 'vitest'
import { buildToolPathPolicy } from '@renderer/intelligence/toolkit/toolPathPolicy'
import { assertPathSafety } from '@shared/toolkit/pathHelper'

const WORKSPACE = '/Volumes/MacData/Ai/aweeclaw'
const EXTERNAL_DIR = '/Volumes/MacData/Customers/Application/depuapp/depu-boot'

describe('buildToolPathPolicy', () => {
    it('把用户配置的工作区外目录纳入放行列表', () => {
        const policy = buildToolPathPolicy({
            allowedToolPaths: [],
            securitySettings: {
                allowedExternalDirectories: [EXTERNAL_DIR],
                strictWorkspaceMode: true,
            },
        })

        expect(policy.extraAllowedRoots).toContain(EXTERNAL_DIR)
        expect(policy.allowOutsideWorkspace).toBe(false)
    })

    it('同时保留项目执行窗口写入的额外目录', () => {
        const projectDir = '/tmp/other-project'
        const policy = buildToolPathPolicy({
            allowedToolPaths: [projectDir],
            securitySettings: {
                allowedExternalDirectories: [EXTERNAL_DIR],
                strictWorkspaceMode: true,
            },
        })

        expect(policy.extraAllowedRoots).toEqual([projectDir, EXTERNAL_DIR])
    })

    it('缺失设置时不放行任何额外目录', () => {
        expect(buildToolPathPolicy({}).extraAllowedRoots).toEqual([])
        expect(
            buildToolPathPolicy({
                allowedToolPaths: null,
                securitySettings: null,
            }).extraAllowedRoots,
        ).toEqual([])
    })

    it('过滤空字符串等无效目录项', () => {
        const policy = buildToolPathPolicy({
            allowedToolPaths: ['', '  '],
            securitySettings: {
                allowedExternalDirectories: [EXTERNAL_DIR, ''],
                strictWorkspaceMode: true,
            },
        })

        // '  ' 原样保留（非空字符串），空串必须被过滤
        expect(policy.extraAllowedRoots).not.toContain('')
        expect(policy.extraAllowedRoots).toContain(EXTERNAL_DIR)
    })

    it('关闭严格工作区模式时跳过工作区边界检查', () => {
        const policy = buildToolPathPolicy({
            securitySettings: {
                allowedExternalDirectories: [],
                strictWorkspaceMode: false,
            },
        })

        expect(policy.allowOutsideWorkspace).toBe(true)
    })

    it('放行策略可让工作区外目录通过 assertPathSafety 校验', () => {
        const policy = buildToolPathPolicy({
            securitySettings: {
                allowedExternalDirectories: [EXTERNAL_DIR],
                strictWorkspaceMode: true,
            },
        })

        const target = `${EXTERNAL_DIR}/src/main/java/depu`

        // 未配置外部目录时：被工作区边界拦截（复现用户报的问题）
        expect(
            assertPathSafety(target, WORKSPACE, { extraAllowedRoots: [] }),
        ).toMatchObject({ valid: false, error: 'Path is outside workspace' })

        // 配置了外部目录后：校验通过
        expect(
            assertPathSafety(target, WORKSPACE, {
                allowOutsideWorkspace: policy.allowOutsideWorkspace,
                extraAllowedRoots: policy.extraAllowedRoots,
            }),
        ).toMatchObject({ valid: true })
    })

    it('工作区外目录放行后仍拦截敏感路径', () => {
        const homeDir = '/Users/someone'
        const policy = buildToolPathPolicy({
            securitySettings: {
                allowedExternalDirectories: [homeDir],
                strictWorkspaceMode: true,
            },
        })

        expect(
            assertPathSafety(`${homeDir}/.ssh/id_rsa`, WORKSPACE, {
                allowOutsideWorkspace: policy.allowOutsideWorkspace,
                extraAllowedRoots: policy.extraAllowedRoots,
            }),
        ).toMatchObject({ valid: false, error: 'Access to sensitive path denied' })
    })
})
