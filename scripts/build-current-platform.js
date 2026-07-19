/**
 * 当前平台打包脚本
 *
 * 用法：
 *   npm run dist                  (自动检测当前平台+架构)
 *   node scripts/build-current-platform.js
 *
 * 输出目录结构（与 build-cross-platform.js 保持一致）：
 *   release/
 *   ├── windows/x64/         (Windows 上运行时输出)
 *   ├── windows/arm64/       (Windows ARM64 上运行时输出)
 *   ├── macos/x64/           (macOS Intel 上运行时输出)
 *   ├── macos/arm64/         (macOS Apple Silicon 上运行时输出)
 *   ├── linux/x64/           (Linux 64位上运行时输出)
 *   └── linux/arm64/         (Linux ARM64 上运行时输出)
 *
 * 原理：
 *   1. 通过 process.platform 和 process.arch 自动检测当前平台
 *   2. 映射到 build-cross-platform.js 中的 target + arch 参数
 *   3. 复用 build-cross-platform.js 的打包逻辑
 *
 * 设计原则：
 *   - 与 dist-w / dist-m / dist-l 保持一致的输出目录结构
 *   - 不需要手动指定 --target，避免在不同平台误打包
 */

const { execSync } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

// ============ 平台检测 ============
const PLATFORM_MAP = {
  win32: 'win',
  darwin: 'mac',
  linux: 'linux',
}

// Node.js process.arch → electron-builder arch 参数
// 注意：Node.js 的 arch 名称与 electron-builder 一致（x64 / arm64 / ia32）
const ARCH_MAP = {
  x64: 'x64',
  arm64: 'arm64',
  ia32: 'ia32',
}

const currentPlatform = process.platform
const currentArch = process.arch

const target = PLATFORM_MAP[currentPlatform]
const arch = ARCH_MAP[currentArch] || 'x64'

if (!target) {
  console.error(`❌ Unsupported platform: ${currentPlatform}`)
  console.error(`   Supported platforms: ${Object.keys(PLATFORM_MAP).join(', ')}`)
  process.exit(1)
}

console.log('=== AweeClaw Build (Current Platform) ===')
console.log(`Detected platform: ${currentPlatform} → target=${target}`)
console.log(`Detected arch:     ${currentArch} → arch=${arch}`)
console.log('')

// ============ 复用 build-cross-platform.js ============
// 通过 spawn 同步执行 build-cross-platform.js，保留 stdio 透传以显示构建日志
const buildScript = path.join(__dirname, 'build-cross-platform.js')
const args = [`node`, buildScript, `--target=${target}`, `--arch=${arch}`]

try {
  execSync(args.join(' '), {
    stdio: 'inherit',
    cwd: ROOT,
  })
} catch (err) {
  console.error(`\n❌ Build failed: ${err.message}`)
  process.exit(1)
}
