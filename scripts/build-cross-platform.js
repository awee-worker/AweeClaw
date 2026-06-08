/**
 * 跨平台打包脚本
 *
 * 用法：
 *   node scripts/build-cross-platform.js --target=win    (打包 Windows)
 *   node scripts/build-cross-platform.js --target=mac    (打包 macOS)
 *   node scripts/build-cross-platform.js --target=linux  (打包 Linux)
 *   node scripts/build-cross-platform.js --target=all    (打包所有平台)
 *
 * 原理：
 *   1. 先执行 vite build 构建前端和主进程代码（纯 JS，跨平台通用）
 *   2. 安装目标平台的原生模块二进制
 *   3. 执行 electron-builder 打包
 *
 * 注意：
 *   - node-pty 自带所有平台预编译二进制（prebuilds/），无需额外处理
 *   - sharp、@lancedb、@parcel/watcher 使用平台子包，需要按目标平台安装
 *   - ssh2/cpu-features 为纯 JS + 可选原生加速，不影响打包
 */

const { execSync } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

// 解析命令行参数
const args = process.argv.slice(2)
let target = 'all'
for (const arg of args) {
  if (arg.startsWith('--target=')) {
    target = arg.split('=')[1]
  }
}

const VALID_TARGETS = ['win', 'mac', 'linux', 'all']
if (!VALID_TARGETS.includes(target)) {
  console.error(`Invalid target: ${target}. Valid targets: ${VALID_TARGETS.join(', ')}`)
  process.exit(1)
}

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
 * 获取目标平台需要安装的原生模块包列表
 */
function getPlatformPackages(platform) {
  const packages = []

  // sharp 平台包（@img/sharp-*）
  const sharpMap = {
    win32: ['@img/sharp-win32-x64@^0.34.5', '@img/sharp-libvips-win32-x64@^1.2.4'],
    darwin: ['@img/sharp-darwin-x64@^0.34.5', '@img/sharp-darwin-arm64@^0.34.5'],
    linux: ['@img/sharp-linux-x64@^0.34.5', '@img/sharp-libvips-linux-x64@^1.2.4'],
  }

  // @lancedb 平台包
  const lancedbMap = {
    win32: ['@lancedb/lancedb-win32-x64-msvc@^0.22.3'],
    darwin: ['@lancedb/lancedb-darwin-x64@^0.22.3', '@lancedb/lancedb-darwin-arm64@^0.22.3'],
    linux: ['@lancedb/lancedb-linux-x64-gnu@^0.22.3'],
  }

  // @parcel/watcher 平台包
  const parcelMap = {
    win32: ['@parcel/watcher-win32-x64@^2.4.1'],
    darwin: ['@parcel/watcher-darwin-x64@^2.4.1', '@parcel/watcher-darwin-arm64@^2.4.1'],
    linux: ['@parcel/watcher-linux-x64-glibc@^2.4.1'],
  }

  const maps = [sharpMap, lancedbMap, parcelMap]
  for (const map of maps) {
    if (map[platform]) {
      packages.push(...map[platform])
    }
  }

  return packages
}

/**
 * 安装目标平台的原生模块
 */
function installPlatformNatives(platform) {
  console.log(`\n📦 Installing native modules for ${platform}...`)

  const packages = getPlatformPackages(platform)
  if (packages.length === 0) {
    console.log('No additional packages needed.')
    return
  }

  console.log(`Packages: ${packages.join(', ')}`)
  // 使用 npm install --no-save 避免修改 package.json
  run(`npm install --no-save ${packages.join(' ')}`)
}

/**
 * 执行打包
 */
function buildForTarget(targetPlatform, builderArgs) {
  console.log(`\n🚀 Building for ${targetPlatform}...`)

  // 1. 构建前端和主进程代码
  console.log('\n📋 Step 1: Building application code...')
  run('npm run build')

  // 2. 安装目标平台原生模块
  console.log('\n📋 Step 2: Installing platform native modules...')
  installPlatformNatives(targetPlatform)

  // 3. 执行 electron-builder
  console.log('\n📋 Step 3: Running electron-builder...')
  run(`npx electron-builder ${builderArgs}`)
}

// 主流程
console.log('=== AweeClaw Cross-Platform Build ===')
console.log(`Target: ${target}`)

switch (target) {
  case 'win':
    buildForTarget('win32', '-w=nsis --x64')
    break
  case 'mac':
    buildForTarget('darwin', '-m')
    break
  case 'linux':
    buildForTarget('linux', '-l=AppImage --x64')
    break
  case 'all':
    buildForTarget('win32', '-w=nsis --x64')
    buildForTarget('darwin', '-m')
    buildForTarget('linux', '-l=AppImage --x64')
    break
}

console.log('\n✅ Build completed successfully!')
