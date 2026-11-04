/**
 * jdtls 启动参数组装
 *
 * 单独成文件的原因：这段逻辑只依赖路径与平台信息，没有任何 Electron / 进程依赖，
 * 可以直接被测试覆盖。选错 config_* 目录会加载到别的架构的原生 launcher 片段，
 * 表现是 JVM 一起就退出，日志里只有一堆 OSGi 找不到 bundle 的信息，很难定位。
 */

export interface JdtlsLaunchInput {
  /** plugins 下 equinox launcher jar 的绝对路径 */
  launcherPath: string
  /** jdtls 解压根目录（含 plugins / config_*） */
  jdtlsRoot: string
  /** 工作区数据目录，jdtls 用来存放索引 */
  dataDir: string
  platform: string
  arch: string
  exists: (target: string) => boolean
}

export interface JdtlsLaunchPlan {
  /** 命中的 config_* 目录绝对路径；null 表示归档结构不完整 */
  configDir: string | null
  args: string[]
}

/**
 * 按平台 + 架构给出候选 config 目录，从最精确到最宽松
 *
 * mac / linux 的归档同时带 x86_64 与 aarch64 两套原生片段，
 * arm 机器必须优先命中 *_arm，否则会加载错误架构的 launcher。
 */
export function getJdtlsConfigCandidates(
  jdtlsRoot: string,
  platform: string,
  arch: string,
): string[] {
  const isArm = arch === 'arm64'
  const names =
    platform === 'win32'
      ? ['config_win']
      : platform === 'darwin'
        ? (isArm ? ['config_mac_arm', 'config_mac'] : ['config_mac'])
        : (isArm ? ['config_linux_arm', 'config_linux'] : ['config_linux'])

  return names.map((name) => `${jdtlsRoot}/${name}`)
}

/** 组装 java 启动 jdtls 的完整参数（不含可执行文件本身） */
export function buildJdtlsLaunchPlan(input: JdtlsLaunchInput): JdtlsLaunchPlan {
  const { launcherPath, jdtlsRoot, dataDir, platform, arch, exists } = input

  const configDir = getJdtlsConfigCandidates(jdtlsRoot, platform, arch).find((dir) => exists(dir)) ?? null

  const args = [
    '-Declipse.application=org.eclipse.jdt.ls.core.id1',
    '-Dosgi.bundles.defaultStartLevel=4',
    '-Declipse.product=org.eclipse.jdt.ls.core.product',
    '-Dlog.level=WARNING',
    '-Xmx1G',
    '--add-modules=ALL-SYSTEM',
    '--add-opens', 'java.base/java.util=ALL-UNNAMED',
    '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
    '-jar', launcherPath,
  ]

  // 缺 configuration 时仍返回参数，交由调用方判空后放弃启动：
  // 没有 config 的 jdtls 会以 0 退出，看起来像「启动了但什么都不返回」
  if (configDir) {
    args.push('-configuration', configDir)
  }
  args.push('-data', dataDir)

  return { configDir, args }
}
