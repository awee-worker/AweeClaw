/**
 * jdtls 启动参数组装测试
 *
 * 三类历史高风险点：
 *  1) arm 机器命中 x86_64 的 config_* → JVM 起不来（原生 launcher 片段架构不符）
 *  2) 归档里没有 config 目录时仍然拼出参数 → jdtls 以 0 退出，看起来像"启动了但没响应"
 *  3) 已弃用的 -noverify 混进参数 → 每次启动都刷 JDK 弃用警告
 */
import { describe, it, expect } from 'vitest'
import { getJdtlsConfigCandidates, buildJdtlsLaunchPlan } from '@main/language-server/jdtlsLauncher'

const ROOT = '/lsp-servers/jdtls'
const LAUNCHER = `${ROOT}/plugins/org.eclipse.equinox.launcher_1.8.0.v20260804-1928.jar`
const DATA = '/lsp-servers/jdtls-data'

/** 只让给定目录"存在" */
const only = (...dirs: string[]) => (target: string) => dirs.includes(target)

describe('getJdtlsConfigCandidates', () => {
  it('macOS arm64 优先 *_arm，再退回通用目录', () => {
    expect(getJdtlsConfigCandidates(ROOT, 'darwin', 'arm64')).toEqual([
      `${ROOT}/config_mac_arm`,
      `${ROOT}/config_mac`,
    ])
  })

  it('macOS x64 只用 config_mac', () => {
    expect(getJdtlsConfigCandidates(ROOT, 'darwin', 'x64')).toEqual([`${ROOT}/config_mac`])
  })

  it('Linux arm64 优先 config_linux_arm', () => {
    expect(getJdtlsConfigCandidates(ROOT, 'linux', 'arm64')).toEqual([
      `${ROOT}/config_linux_arm`,
      `${ROOT}/config_linux`,
    ])
  })

  it('Linux x64 只用 config_linux', () => {
    expect(getJdtlsConfigCandidates(ROOT, 'linux', 'x64')).toEqual([`${ROOT}/config_linux`])
  })

  it('Windows 只用 config_win', () => {
    expect(getJdtlsConfigCandidates(ROOT, 'win32', 'x64')).toEqual([`${ROOT}/config_win`])
  })
})

describe('buildJdtlsLaunchPlan', () => {
  it('arm 机器两个目录都存在时选 *_arm', () => {
    const plan = buildJdtlsLaunchPlan({
      launcherPath: LAUNCHER,
      jdtlsRoot: ROOT,
      dataDir: DATA,
      platform: 'darwin',
      arch: 'arm64',
      exists: only(`${ROOT}/config_mac_arm`, `${ROOT}/config_mac`),
    })
    expect(plan.configDir).toBe(`${ROOT}/config_mac_arm`)
  })

  it('老归档只有 config_mac 时回退，不放弃启动', () => {
    const plan = buildJdtlsLaunchPlan({
      launcherPath: LAUNCHER,
      jdtlsRoot: ROOT,
      dataDir: DATA,
      platform: 'darwin',
      arch: 'arm64',
      exists: only(`${ROOT}/config_mac`),
    })
    expect(plan.configDir).toBe(`${ROOT}/config_mac`)
    expect(plan.args).toContain('-configuration')
  })

  it('config 目录全缺失时 configDir 为 null 且不拼 -configuration', () => {
    const plan = buildJdtlsLaunchPlan({
      launcherPath: LAUNCHER,
      jdtlsRoot: ROOT,
      dataDir: DATA,
      platform: 'darwin',
      arch: 'arm64',
      exists: () => false,
    })
    expect(plan.configDir).toBeNull()
    expect(plan.args).not.toContain('-configuration')
  })

  it('参数里带上 launcher jar 与数据目录', () => {
    const plan = buildJdtlsLaunchPlan({
      launcherPath: LAUNCHER,
      jdtlsRoot: ROOT,
      dataDir: DATA,
      platform: 'darwin',
      arch: 'arm64',
      exists: only(`${ROOT}/config_mac_arm`),
    })
    const jarIndex = plan.args.indexOf('-jar')
    expect(jarIndex).toBeGreaterThan(-1)
    expect(plan.args[jarIndex + 1]).toBe(LAUNCHER)

    const dataIndex = plan.args.indexOf('-data')
    expect(dataIndex).toBeGreaterThan(-1)
    expect(plan.args[dataIndex + 1]).toBe(DATA)
  })

  it('数据目录含空格时保持为单个参数', () => {
    const plan = buildJdtlsLaunchPlan({
      launcherPath: LAUNCHER,
      jdtlsRoot: ROOT,
      dataDir: '/Users/me/Application Support/aweeclaw/jdtls-data',
      platform: 'darwin',
      arch: 'arm64',
      exists: only(`${ROOT}/config_mac_arm`),
    })
    const dataIndex = plan.args.indexOf('-data')
    expect(plan.args[dataIndex + 1]).toBe('/Users/me/Application Support/aweeclaw/jdtls-data')
  })

  it('不再包含已弃用的 -noverify', () => {
    const plan = buildJdtlsLaunchPlan({
      launcherPath: LAUNCHER,
      jdtlsRoot: ROOT,
      dataDir: DATA,
      platform: 'linux',
      arch: 'x64',
      exists: only(`${ROOT}/config_linux`),
    })
    expect(plan.args).not.toContain('-noverify')
    expect(plan.args).toContain('--add-modules=ALL-SYSTEM')
  })
})
