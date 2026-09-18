/**
 * 工具路径放行策略单元测试
 *
 * 锁定两类会被回归踩坏的行为：
 * 1. 可信应用数据目录（插件 / 场景 / 技能 / 运行时所在目录）必须并入「读写放行」，
 *    否则 AI 读不到工作区之外的插件文档与脚本，插件调用直接失败；
 * 2. 只读可信目录只在读取操作放行，不得混入读写放行列表。
 *
 * @module Toolkit/toolPathPolicy/test
 */

import { describe, it, expect } from 'vitest'
import { buildToolPathPolicy } from '../toolPathPolicy'

describe('buildToolPathPolicy', () => {
    it('把可信应用数据目录并入读写放行列', () => {
        const policy = buildToolPathPolicy({
            trustedAppDataRoots: ['/Users/demo/Library/Application Support/AweeClaw'],
        })

        expect(policy.extraAllowedRoots).toEqual(['/Users/demo/Library/Application Support/AweeClaw'])
        expect(policy.extraReadOnlyRoots).toEqual([])
    })

    it('合并项目目录、用户配置目录与可信应用数据目录', () => {
        const policy = buildToolPathPolicy({
            allowedToolPaths: ['/work/project-a'],
            securitySettings: { allowedExternalDirectories: ['/opt/shared-lib'], strictWorkspaceMode: true },
            trustedAppDataRoots: ['/Users/demo/Library/Application Support/AweeClaw'],
        })

        expect(policy.extraAllowedRoots).toEqual([
            '/work/project-a',
            '/opt/shared-lib',
            '/Users/demo/Library/Application Support/AweeClaw',
        ])
        expect(policy.allowOutsideWorkspace).toBe(false)
    })

    it('只读可信目录与读写放行列表分离', () => {
        const policy = buildToolPathPolicy({
            trustedAppDataRoots: ['/Users/demo/Library/Application Support/AweeClaw'],
            trustedReadOnlyRoots: ['/Users/demo/Library/Application Support/AweeClaw/.aweeclaw/uploads'],
        })

        expect(policy.extraAllowedRoots).toEqual(['/Users/demo/Library/Application Support/AweeClaw'])
        expect(policy.extraReadOnlyRoots).toEqual([
            '/Users/demo/Library/Application Support/AweeClaw/.aweeclaw/uploads',
        ])
    })

    it('过滤空值与非法项，缺省时返回空列表', () => {
        const policy = buildToolPathPolicy({
            allowedToolPaths: null,
            trustedAppDataRoots: ['', '/valid', undefined as unknown as string],
        })

        expect(policy.extraAllowedRoots).toEqual(['/valid'])
        expect(policy.extraReadOnlyRoots).toEqual([])
        expect(policy.allowOutsideWorkspace).toBe(false)
    })

    it('关闭严格工作区模式时跳过边界检查', () => {
        const policy = buildToolPathPolicy({
            securitySettings: { strictWorkspaceMode: false },
        })

        expect(policy.allowOutsideWorkspace).toBe(true)
    })
})
