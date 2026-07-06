/**
 * 跨平台打包脚本
 *
 * 用法：
 *   node scripts/build-cross-platform.js --target=win              (打包 Windows x64)
 *   node scripts/build-cross-platform.js --target=win --arch=ia32  (打包 Windows 32位)
 *   node scripts/build-cross-platform.js --target=win --arch=arm64 (打包 Windows ARM64)
 *   node scripts/build-cross-platform.js --target=mac              (打包 macOS x64)
 *   node scripts/build-cross-platform.js --target=mac --arch=arm64 (打包 macOS ARM64)
 *   node scripts/build-cross-platform.js --target=linux            (打包 Linux x64)
 *   node scripts/build-cross-platform.js --target=linux --arch=arm64 (打包 Linux ARM64)
 *   node scripts/build-cross-platform.js --target=linux --format=deb (打包 Linux deb)
 *   node scripts/build-cross-platform.js --target=all              (打包所有平台 x64)
 *
 * 输出目录结构：
 *   release/
 *   ├── windows/x64/         (Windows 64位安装包)
 *   ├── windows/ia32/        (Windows 32位安装包)
 *   ├── windows/arm64/       (Windows ARM64安装包)
 *   ├── macos/x64/           (macOS 64位安装包)
 *   ├── macos/arm64/         (macOS ARM64安装包)
 *   ├── linux/x64/           (Linux 64位安装包)
 *   ├── linux/ia32/          (Linux 32位安装包)
 *   ├── linux/arm64/         (Linux ARM64安装包)
 *   └── linux/x64-deb/       (Linux deb包)
 *
 * 原理：
 *   1. 先执行 vite build 构建前端和主进程代码（纯 JS，跨平台通用）
 *   2. 安装目标平台的原生模块二进制（根据 arch 安装对应架构）
 *   3. 执行 electron-builder 打包，输出到 release/{platform}/{arch}/
 *
 * 注意：
 *   - node-pty 自带所有平台预编译二进制（prebuilds/），无需额外处理
 *   - sharp、@lancedb、@parcel/watcher 使用平台子包，需要按目标平台+架构安装
 *   - ssh2/cpu-features 为纯 JS + 可选原生加速，不影响打包
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const ROOT = path.resolve(__dirname, '..')

// ============ 参数解析 ============
const args = process.argv.slice(2)
let target = 'all'
let arch = 'x64'
let format = '' // Linux 格式：AppImage / deb，空则用默认 AppImage

for (const arg of args) {
  if (arg.startsWith('--target=')) {
    target = arg.split('=')[1]
  } else if (arg.startsWith('--arch=')) {
    arch = arg.split('=')[1]
  } else if (arg.startsWith('--format=')) {
    format = arg.split('=')[1]
  }
}

const VALID_TARGETS = ['win', 'mac', 'linux', 'all']
const VALID_ARCHES = ['x64', 'ia32', 'arm64']

if (!VALID_TARGETS.includes(target)) {
  console.error(`Invalid target: ${target}. Valid targets: ${VALID_TARGETS.join(', ')}`)
  process.exit(1)
}

if (!VALID_ARCHES.includes(arch)) {
  console.error(`Invalid arch: ${arch}. Valid arches: ${VALID_ARCHES.join(', ')}`)
  process.exit(1)
}

// ============ 平台映射 ============
const PLATFORM_MAP = {
  win: { npmPlatform: 'win32', outputDir: 'windows', electronFlag: '-w=nsis' },
  mac: { npmPlatform: 'darwin', outputDir: 'macos', electronFlag: '-m' },
  linux: { npmPlatform: 'linux', outputDir: 'linux', electronFlag: '-l=AppImage' },
}

// ============ 工具函数 ============

/**
 * 执行命令并打印输出
 */
function run(cmd, options = {}) {
  console.log(`\n> ${cmd}\n`)
  try {
    execSync(cmd, {
      stdio: 'inherit',
      cwd: ROOT,
      ...options,
    })
  } catch (err) {
    console.error(`Command failed: ${cmd}`)
    process.exit(1)
  }
}

/**
 * 根据目标平台和架构获取需要安装的原生模块包列表
 * @param {string} platform - win32 / darwin / linux
 * @param {string} arch - x64 / ia32 / arm64
 * @returns {string[]} 包名数组（带版本号）
 */
function getPlatformPackages(platform, arch) {
  const packages = []

  // sharp 平台包（@img/sharp-*）
  // 注意：sharp 0.34+ 的 win32-ia32 不存在，32位 Windows 不支持
  const sharpMap = {
    win32: {
      x64: ['@img/sharp-win32-x64@^0.34.5', '@img/sharp-libvips-win32-x64@^1.2.4'],
      arm64: ['@img/sharp-win32-arm64@^0.34.5', '@img/sharp-libvips-win32-arm64@^1.2.4'],
      // ia32: 不支持
    },
    darwin: {
      x64: ['@img/sharp-darwin-x64@^0.34.5', '@img/sharp-libvips-darwin-x64@^1.2.4'],
      arm64: ['@img/sharp-darwin-arm64@^0.34.5', '@img/sharp-libvips-darwin-arm64@^1.2.4'],
    },
    linux: {
      x64: ['@img/sharp-linux-x64@^0.34.5', '@img/sharp-libvips-linux-x64@^1.2.4'],
      arm64: ['@img/sharp-linux-arm64@^0.34.5', '@img/sharp-libvips-linux-arm64@^1.2.4'],
    },
  }

  // @lancedb 平台包
  // 注意：lancedb 不支持 win32-ia32
  const lancedbMap = {
    win32: {
      x64: ['@lancedb/lancedb-win32-x64-msvc@^0.22.3'],
      arm64: ['@lancedb/lancedb-win32-arm64-msvc@^0.22.3'],
    },
    darwin: {
      x64: ['@lancedb/lancedb-darwin-x64@^0.22.3'],
      arm64: ['@lancedb/lancedb-darwin-arm64@^0.22.3'],
    },
    linux: {
      x64: ['@lancedb/lancedb-linux-x64-gnu@^0.22.3'],
      arm64: ['@lancedb/lancedb-linux-arm64-gnu@^0.22.3'],
    },
  }

  // @parcel/watcher 平台包
  const parcelMap = {
    win32: {
      x64: ['@parcel/watcher-win32-x64@^2.4.1'],
      ia32: ['@parcel/watcher-win32-ia32@^2.4.1'],
      arm64: ['@parcel/watcher-win32-arm64@^2.4.1'],
    },
    darwin: {
      x64: ['@parcel/watcher-darwin-x64@^2.4.1'],
      arm64: ['@parcel/watcher-darwin-arm64@^2.4.1'],
    },
    linux: {
      x64: ['@parcel/watcher-linux-x64-glibc@^2.4.1'],
      arm64: ['@parcel/watcher-linux-arm64-glibc@^2.4.1'],
    },
  }

  const maps = [sharpMap, lancedbMap, parcelMap]
  for (const map of maps) {
    const platformPackages = map[platform]?.[arch]
    if (platformPackages) {
      packages.push(...platformPackages)
    }
  }

  return packages
}

/**
 * 移除原生包 package.json 中的 os 和 cpu 字段
 *
 * 原因：electron-builder 在交叉打包时（如在 macOS 上构建 Windows 包），
 * 会根据 package.json 的 os/cpu 字段过滤 optionalDependencies。
 * 即使指定了 --win --x64，构建机平台为 darwin 时，
 * os: ["win32"] 的包仍可能被误判为"当前平台不兼容"而被排除。
 *
 * 移除 os/cpu 后，electron-builder 会无条件包含这些包，
 * 由 afterPack.js 根据目标平台清理非目标平台的二进制。
 *
 * @param {string} pkgDir - 包目录绝对路径
 */
function stripPlatformFields(pkgDir) {
  const pkgJsonPath = path.join(pkgDir, 'package.json')
  if (!fs.existsSync(pkgJsonPath)) {
    console.warn(`  ⚠️ package.json not found in ${pkgDir}, skip strip`)
    return
  }

  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
    let modified = false

    if (pkgJson.os) {
      delete pkgJson.os
      modified = true
    }
    if (pkgJson.cpu) {
      delete pkgJson.cpu
      modified = true
    }

    if (modified) {
      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf-8')
      console.log(`  ✓ Stripped os/cpu fields from ${pkgJson.name || pkgDir}`)
    }
  } catch (err) {
    console.warn(`  ⚠️ Failed to strip os/cpu from ${pkgDir}: ${err.message}`)
  }
}

/**
 * 解析包名为 { name, version } 对象
 * @param {string} pkg - 包名（带版本），如 '@parcel/watcher-win32-x64@^2.4.1'
 * @returns {{name: string, version: string}}
 */
function parsePackageSpec(pkg) {
  // 处理 @scope/name@version 格式
  const lastAt = pkg.lastIndexOf('@')
  if (lastAt <= 0) return { name: pkg, version: 'latest' }
  return {
    name: pkg.substring(0, lastAt),
    version: pkg.substring(lastAt + 1),
  }
}

/**
 * 安装目标平台的原生模块
 *
 * 使用 npm pack 下载 tarball + 手动解压到 node_modules 的方式
 * 绕过 npm 的平台检查（npm 11+ 即使 --force 也会跳过非当前平台的原生包）
 *
 * @param {string} platform - win32 / darwin / linux
 * @param {string} arch - x64 / ia32 / arm64
 */
function installPlatformNatives(platform, arch) {
  console.log(`\n📦 Installing native modules for ${platform}-${arch}...`)

  const packages = getPlatformPackages(platform, arch)
  if (packages.length === 0) {
    console.log('No additional packages needed.')
    return
  }

  console.log(`Packages: ${packages.join(', ')}`)

  // 创建临时目录用于存放下载的 tarball
  const tmpDir = path.join(os.tmpdir(), `aweeclaw-natives-${platform}-${arch}-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  try {
    for (const pkgSpec of packages) {
      const { name, version } = parsePackageSpec(pkgSpec)

      // 1. 使用 npm pack 下载 tarball（npm pack 会绕过平台检查）
      console.log(`  → Downloading ${name}@${version}...`)
      const tarballName = execSync(
        `npm pack ${name}@${version} --pack-destination ${tmpDir}`,
        { cwd: ROOT, encoding: 'utf-8' }
      ).trim()
      const tarballPath = path.join(tmpDir, tarballName)

      // 2. 解压到 node_modules 对应目录
      //    tarball 内部结构：package/xxx，需要 --strip-components=1 去掉 package 前缀
      const destDir = path.join(ROOT, 'node_modules', name)
      // 确保父目录存在
      fs.mkdirSync(path.dirname(destDir), { recursive: true })
      // 如果已存在先删除（避免残留旧文件）
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
      }
      fs.mkdirSync(destDir, { recursive: true })

      // 使用 tar 解压（macOS 和 Linux 自带 tar）
      execSync(`tar -xzf ${tarballPath} -C ${destDir} --strip-components=1`, {
        cwd: ROOT,
        stdio: 'inherit',
      })

      // 移除 package.json 中的 os/cpu 字段
      // 原因：electron-builder 在交叉打包时会根据 os/cpu 过滤 optionalDependencies，
      // 导致目标平台的原生包被排除在 asar 之外。移除这两个字段后，
      // electron-builder 会无条件包含这些包，由 afterPack.js 负责清理非目标平台包。
      stripPlatformFields(destDir)

      console.log(`  ✓ Installed ${name} → node_modules/${name}/`)
    }
  } finally {
    // 清理临时目录
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch { /* 忽略清理失败 */ }
  }
}

/**
 * 计算输出目录
 * @param {string} target - win / mac / linux
 * @param {string} arch - x64 / ia32 / arm64
 * @param {string} format - Linux 格式（仅 Linux 使用）
 * @returns {string} 输出目录路径（相对于项目根目录）
 */
function getOutputDir(target, arch, format) {
  const platformInfo = PLATFORM_MAP[target]
  let archDir = arch

  // Linux deb 等不同格式用独立目录
  if (target === 'linux' && format && format !== 'AppImage') {
    archDir = `${arch}-${format}`
  }

  return `release/${platformInfo.outputDir}/${archDir}`
}

/**
 * 执行打包
 * @param {string} target - win / mac / linux
 * @param {string} arch - x64 / ia32 / arm64
 * @param {string} format - Linux 格式
 */
function buildForTarget(target, arch, format) {
  const platformInfo = PLATFORM_MAP[target]
  const npmPlatform = platformInfo.npmPlatform
  const outputDir = getOutputDir(target, arch, format)

  console.log(`\n🚀 Building for ${target}-${arch}${format ? ` (${format})` : ''}...`)
  console.log(`   Output: ${outputDir}`)

  // 1. 构建前端和主进程代码
  console.log('\n📋 Step 1: Building application code...')
  run('npm run build')

  // 2. 安装目标平台原生模块
  console.log('\n📋 Step 2: Installing platform native modules...')
  installPlatformNatives(npmPlatform, arch)

  // 3. 确保输出目录存在
  const outputAbsPath = path.join(ROOT, outputDir)
  if (!fs.existsSync(outputAbsPath)) {
    fs.mkdirSync(outputAbsPath, { recursive: true })
  }

  // 4. 执行 electron-builder
  //    通过 --config.directories.output 动态覆盖输出目录
  //    通过 --config.afterPack 指定 afterPack 脚本
  console.log('\n📋 Step 3: Running electron-builder...')

  // 构造 electron-builder 参数
  let builderArgs = platformInfo.electronFlag
  // macOS 默认构建 universal（包含 x64 + arm64），如果指定 arch 则只构建对应架构
  if (arch === 'arm64') {
    builderArgs += ` --arm64`
  } else if (arch === 'ia32') {
    builderArgs += ` --ia32`
  } else {
    builderArgs += ` --x64`
  }

  // Linux 格式覆盖
  if (target === 'linux' && format) {
    builderArgs = `-l=${format} ${arch === 'arm64' ? '--arm64' : arch === 'ia32' ? '--ia32' : '--x64'}`
  }

  // 动态指定输出目录
  const configOverride = `--config.directories.output=${outputDir}`

  run(`npx electron-builder ${builderArgs} ${configOverride}`)
}

// ============ 主流程 ============
console.log('=== AweeClaw Cross-Platform Build ===')
console.log(`Target: ${target}`)
console.log(`Arch: ${arch}`)
if (format) console.log(`Format: ${format}`)

switch (target) {
  case 'win':
    buildForTarget('win', arch, '')
    break
  case 'mac':
    buildForTarget('mac', arch, '')
    break
  case 'linux':
    buildForTarget('linux', arch, format || 'AppImage')
    break
  case 'all':
    // 打包所有平台 x64
    buildForTarget('win', 'x64', '')
    buildForTarget('mac', 'x64', '')
    buildForTarget('linux', 'x64', 'AppImage')
    break
}

console.log('\n✅ Build completed successfully!')
console.log(`\n📦 Output: release/${PLATFORM_MAP[target === 'all' ? 'win' : target]?.outputDir || ''}/`)
