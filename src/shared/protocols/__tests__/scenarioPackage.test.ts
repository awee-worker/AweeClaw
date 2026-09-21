/**
 * 场景包清单验收
 *
 * 验收目标：不合法清单能被拦下，权限声明能被用户读懂，升级路径含迁移脚本。
 */

import { describe, expect, it } from 'vitest'
import {
  compareVersion,
  describePermission,
  planScenarioPackageUpgrade,
  renderPermissionSummary,
  resolveScenarioInstallOrder,
  validateScenarioPackageManifest,
  type ScenarioPackageManifest,
} from '../scenarioPackage'

function manifest(overrides: Partial<ScenarioPackageManifest> = {}): ScenarioPackageManifest {
  return {
    id: 'pdf-watermark',
    name: 'PDF Watermark',
    nameZh: 'PDF 水印',
    version: '1.0.0',
    description: 'Batch watermark PDF files',
    author: 'aweeclaw',
    category: 'office',
    tags: ['pdf'],
    agent: { systemPrompt: '你是一个 PDF 处理助手' },
    requiredTools: ['read_file', 'write_file'],
    requiredToolPacks: [],
    permissions: [
      { kind: 'read', scope: '工作区内的 pdf 文件', reason: '需要读取待加水印的文件' },
      { kind: 'write', scope: '工作区内的输出目录', reason: '需要写入处理后的文件' },
    ],
    ...overrides,
  }
}

describe('validateScenarioPackageManifest', () => {
  it('合法清单通过校验', () => {
    const result = validateScenarioPackageManifest(manifest())

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('缺少权限声明直接判为不合法', () => {
    const result = validateScenarioPackageManifest(
      manifest({ permissions: undefined as unknown as ScenarioPackageManifest['permissions'] }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('权限声明')
  })

  it('缺少必填字段时报错', () => {
    const result = validateScenarioPackageManifest(
      manifest({ id: '', version: '', agent: { systemPrompt: '' } }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining(['缺少 id', '缺少 version', 'agent.systemPrompt 为空']),
    )
  })

  it('id 含路径字符时被拒绝', () => {
    for (const id of ['../etc/passwd', 'Pdf_Watermark', 'a/b']) {
      expect(validateScenarioPackageManifest(manifest({ id })).valid).toBe(false)
    }
  })

  it('版本必须符合语义化格式', () => {
    expect(validateScenarioPackageManifest(manifest({ version: 'v1' })).valid).toBe(false)
    expect(validateScenarioPackageManifest(manifest({ version: '1.0.0-beta.1' })).valid).toBe(true)
  })

  it('权限项缺范围或理由时报错', () => {
    const result = validateScenarioPackageManifest(
      manifest({ permissions: [{ kind: 'terminal', scope: '', reason: '' }] }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('scope')
    expect(result.errors.join()).toContain('申请理由')
  })

  it('未知权限类型被拒绝', () => {
    const result = validateScenarioPackageManifest(
      manifest({
        permissions: [
          { kind: 'root' as unknown as 'read', scope: 'x', reason: 'y' },
        ],
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('未知的权限类型')
  })

  it('缺中文名与标签只告警不阻断', () => {
    const result = validateScenarioPackageManifest(manifest({ nameZh: undefined, tags: [] }))

    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('清单缺失时返回不合法而非抛错', () => {
    expect(validateScenarioPackageManifest(null).valid).toBe(false)
    expect(validateScenarioPackageManifest(undefined).valid).toBe(false)
  })
})

describe('compareVersion', () => {
  it('按主次修订号比较', () => {
    expect(compareVersion('1.2.0', '1.1.9')).toBe(1)
    expect(compareVersion('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersion('0.9.0', '1.0.0')).toBe(-1)
  })

  it('忽略预发布后缀', () => {
    expect(compareVersion('1.0.0-beta', '1.0.0')).toBe(0)
  })
})

describe('resolveScenarioInstallOrder', () => {
  it('依赖先于被依赖者安装', () => {
    const resolution = resolveScenarioInstallOrder([
      manifest({
        id: 'report',
        dependencies: [{ id: 'chart-kit', version: '1.0.0' }],
      }),
      manifest({ id: 'chart-kit', version: '1.0.0' }),
    ])

    expect(resolution.order.indexOf('chart-kit')).toBeLessThan(resolution.order.indexOf('report'))
    expect(resolution.missing).toEqual([])
  })

  it('缺依赖时显式返回而不是静默失败', () => {
    const resolution = resolveScenarioInstallOrder([
      manifest({ id: 'report', dependencies: [{ id: 'chart-kit', version: '1.0.0' }] }),
    ])

    expect(resolution.missing).toEqual([
      { id: 'chart-kit', requiredBy: 'report', version: '1.0.0' },
    ])
  })

  it('同一依赖被要求不同版本时报冲突', () => {
    const resolution = resolveScenarioInstallOrder([
      manifest({ id: 'a', dependencies: [{ id: 'core', version: '1.0.0' }] }),
      manifest({ id: 'b', dependencies: [{ id: 'core', version: '2.0.0' }] }),
      manifest({ id: 'core', version: '1.0.0' }),
    ])

    expect(resolution.conflicts).toEqual([{ id: 'core', required: ['1.0.0', '2.0.0'] }])
  })
})

describe('planScenarioPackageUpgrade', () => {
  it('首次安装视为可安装', () => {
    const plan = planScenarioPackageUpgrade(null, manifest())

    expect(plan.canUpgrade).toBe(true)
    expect(plan.reason).toContain('首次安装')
  })

  it('版本提高时给出迁移脚本', () => {
    const plan = planScenarioPackageUpgrade(
      manifest({ version: '1.0.0' }),
      manifest({
        version: '1.1.0',
        data: { schema: {}, migrations: ['001-add-column.sql', '002-backfill.sql'] },
      }),
    )

    expect(plan.canUpgrade).toBe(true)
    expect(plan.migrations).toEqual(['001-add-column.sql', '002-backfill.sql'])
  })

  it('版本不提高时不可升级', () => {
    const plan = planScenarioPackageUpgrade(manifest({ version: '1.1.0' }), manifest({ version: '1.1.0' }))

    expect(plan.canUpgrade).toBe(false)
    expect(plan.reason).toContain('不高于当前版本')
  })

  it('id 不一致时拒绝升级', () => {
    const plan = planScenarioPackageUpgrade(manifest({ id: 'a' }), manifest({ id: 'b' }))

    expect(plan.canUpgrade).toBe(false)
    expect(plan.reason).toContain('id 不一致')
  })
})

describe('权限声明展示', () => {
  it('逐条列出权限范围与理由', () => {
    const text = renderPermissionSummary(manifest())

    expect(text).toContain('PDF 水印')
    expect(text).toContain('读取文件')
    expect(text).toContain('工作区内的 pdf 文件')
    expect(text).toContain('需要读取待加水印的文件')
  })

  it('英文环境下输出英文文案', () => {
    const text = renderPermissionSummary(manifest(), 'en')

    expect(text).toContain('Read files')
    expect(text).toContain('requests the following permissions')
  })

  it('无权限时给出明确说明而不是空串', () => {
    expect(renderPermissionSummary(manifest({ permissions: [] }))).toContain('未申请任何权限')
  })

  it('权限类型有中文文案', () => {
    expect(describePermission('terminal')).toBe('执行命令')
    expect(describePermission('network', 'en')).toBe('Network access')
  })
})
