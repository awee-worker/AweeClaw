/**
 * electron-builder afterPack 钩子
 * 清理打包产物中不需要的跨平台原生二进制文件，减小安装包体积
 */
const fs = require('fs')
const path = require('path')

/** 平台到保留目录的映射 */
const PLATFORM_KEEP_MAP = {
  mac: {
    onnxruntime: ['darwin'],
    lancedb: ['darwin'],
    sharp: ['darwin'],
    parcel: ['darwin'],
  },
  win: {
    onnxruntime: ['win32'],
    lancedb: ['win32-x64-msvc'],
    sharp: ['win32-x64', 'win32-arm64'],
    parcel: ['win32'],
  },
  linux: {
    onnxruntime: ['linux'],
    lancedb: ['linux-x64-gnu'],
    sharp: ['linux-x64', 'linux-arm64'],
    parcel: ['linux'],
  },
}

/**
 * 递归删除目录（使用 fs.rmSync，更健壮）
 */
function rmRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return 0
  let removedSize = 0

  try {
    const calcSize = (p) => {
      const stat = fs.statSync(p)
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(p)) {
          calcSize(path.join(p, entry))
        }
      } else {
        removedSize += stat.size
      }
    }
    calcSize(dirPath)
    fs.rmSync(dirPath, { recursive: true, force: true })
  } catch (err) {
    console.warn(`[afterPack] Warning: Failed to remove ${dirPath}: ${err.message}`)
  }

  return removedSize
}

/**
 * 清理 onnxruntime-node 跨平台二进制
 */
function cleanOnnxRuntime(appDir, platform) {
  const binDir = path.join(appDir, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3')
  if (!fs.existsSync(binDir)) return 0

  const keepPlatforms = PLATFORM_KEEP_MAP[platform]?.onnxruntime || []
  let removedSize = 0

  for (const entry of fs.readdirSync(binDir)) {
    if (!keepPlatforms.includes(entry)) {
      removedSize += rmRecursive(path.join(binDir, entry))
    } else if (platform === 'mac') {
      const archDir = path.join(binDir, entry)
      if (fs.statSync(archDir).isDirectory()) {
        for (const arch of fs.readdirSync(archDir)) {
          if (arch !== process.arch) {
            removedSize += rmRecursive(path.join(archDir, arch))
          }
        }
      }
    }
  }

  return removedSize
}

/**
 * 清理 @lancedb 跨平台二进制
 */
function cleanLanceDB(appDir, platform) {
  const lancedbDir = path.join(appDir, 'node_modules', '@lancedb')
  if (!fs.existsSync(lancedbDir)) return 0

  const keepSuffixes = PLATFORM_KEEP_MAP[platform]?.lancedb || []
  let removedSize = 0

  for (const entry of fs.readdirSync(lancedbDir)) {
    if (entry === 'lancedb') continue
    const shouldKeep = keepSuffixes.some(suffix => entry.includes(suffix))
    if (!shouldKeep) {
      removedSize += rmRecursive(path.join(lancedbDir, entry))
    }
  }

  return removedSize
}

/**
 * 清理 @img/sharp 跨平台二进制
 */
function cleanSharp(appDir, platform) {
  const imgDir = path.join(appDir, 'node_modules', '@img')
  if (!fs.existsSync(imgDir)) return 0

  const keepSuffixes = PLATFORM_KEEP_MAP[platform]?.sharp || []
  let removedSize = 0

  for (const entry of fs.readdirSync(imgDir)) {
    if (entry === 'colour') continue
    const shouldKeep = keepSuffixes.some(suffix => entry.includes(suffix))
    if (!shouldKeep) {
      removedSize += rmRecursive(path.join(imgDir, entry))
    }
  }

  return removedSize
}

/**
 * 清理 @parcel/watcher 跨平台二进制
 * - 清理 @parcel/watcher-{平台} 子目录（保留目标平台+架构）
 * - 清理 @parcel/watcher/build/Release/watcher.node（本地编译的二进制，交叉打包时格式不匹配）
 * - 清理 @parcel/watcher/bin/（预构建二进制，同样是当前平台格式）
 * - 补丁 @parcel/watcher/index.js，移除 build/Release 和 build/Debug 回退逻辑
 *   防止目标平台加载到构建机平台的本地编译二进制
 * - 验证目标平台+架构的原生二进制包存在
 *
 * @param {string} appDir - app.asar.unpacked 目录
 * @param {string} platform - mac / win / linux
 * @param {string} arch - x64 / ia32 / arm64 / arm
 */
function cleanParcelWatcher(appDir, platform, arch) {
  const parcelDir = path.join(appDir, 'node_modules', '@parcel')
  if (!fs.existsSync(parcelDir)) return 0

  const keepSuffixes = PLATFORM_KEEP_MAP[platform]?.parcel || []
  let removedSize = 0

  // 1. 清理非目标平台+架构的 @parcel/watcher-* 子目录
  //    keepSuffixes 包含平台名（如 'win32'），但还需要根据 arch 精确过滤
  //    例如打 win-x64 包时，应保留 watcher-win32-x64，清理 watcher-win32-ia32/arm64
  for (const entry of fs.readdirSync(parcelDir)) {
    if (entry === 'watcher') continue

    // 必须匹配平台前缀
    const platformMatched = keepSuffixes.some(suffix => entry.includes(suffix))
    if (!platformMatched) {
      removedSize += rmRecursive(path.join(parcelDir, entry))
      continue
    }

    // 平台匹配后，还要检查架构：watcher-{platform}-{arch}
    // entry 格式：watcher-win32-x64 / watcher-win32-ia32 / watcher-win32-arm64
    // 如果 entry 末尾的 arch 不等于目标 arch，则清理
    // 注意 macOS 的 arch 映射：process.arch='arm64' 对应 watcher-darwin-arm64
    const entryArch = entry.split('-').pop()
    if (entryArch !== arch) {
      removedSize += rmRecursive(path.join(parcelDir, entry))
    }
  }

  // 2. 清理 @parcel/watcher/build/Release/watcher.node（本地编译的二进制）
  //    交叉打包时这个二进制是构建机平台格式，目标平台无法加载
  //    目标平台应使用 @parcel/watcher-{platform}-{arch}/watcher.node
  const watcherBuildDir = path.join(parcelDir, 'watcher', 'build')
  if (fs.existsSync(watcherBuildDir)) {
    removedSize += rmRecursive(watcherBuildDir)
  }

  // 3. 清理 @parcel/watcher/bin/（预构建二进制，同样是构建机平台格式）
  const watcherBinDir = path.join(parcelDir, 'watcher', 'bin')
  if (fs.existsSync(watcherBinDir)) {
    removedSize += rmRecursive(watcherBinDir)
  }

  // 4. 补丁 @parcel/watcher/index.js，移除 build/Release 和 build/Debug 回退逻辑
  //    这样即使 build/ 目录残留，也不会加载到错误平台的二进制
  patchParcelWatcherIndex(parcelDir)

  // 5. 验证目标平台+架构的原生二进制包存在
  verifyPlatformWatcherBinary(parcelDir, platform, arch)

  return removedSize
}

/**
 * 补丁 @parcel/watcher/index.js
 *
 * 原始加载逻辑：
 *   1. require('@parcel/watcher-{platform}-{arch}')  // 平台子包（正确）
 *   2. require('./build/Release/watcher.node')        // 本地编译（跨平台错误）
 *   3. require('./build/Debug/watcher.node')          // debug 构建（跨平台错误）
 *
 * 补丁后只保留第 1 步，移除 2/3 回退，避免加载到构建机平台的二进制
 */
function patchParcelWatcherIndex(parcelDir) {
  const indexPath = path.join(parcelDir, 'watcher', 'index.js')
  if (!fs.existsSync(indexPath)) {
    console.warn('[afterPack] @parcel/watcher/index.js not found, skipping patch')
    return
  }

  try {
    const content = fs.readFileSync(indexPath, 'utf-8')

    // 检测是否已补丁过（幂等）
    if (content.includes('[afterPack patched]')) {
      console.log('[afterPack] @parcel/watcher/index.js already patched, skip')
      return
    }

    // 定位原始 try-catch 块边界：从 "let binding;" 到 "function handleError"
    const startIdx = content.indexOf('let binding;')
    const endIdx = content.indexOf('function handleError')
    if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
      console.warn('[afterPack] ⚠️ Cannot locate binding block in @parcel/watcher/index.js, skip patch')
      return
    }

    const before = content.substring(0, startIdx)
    const after = content.substring(endIdx)

    // 构造补丁后的加载逻辑：只使用平台子包，不回退到本地构建
    const patchedBlock = [
      '// [afterPack patched] 移除 build/Release 和 build/Debug 回退逻辑，避免跨平台加载错误二进制',
      'let binding;',
      'try {',
      '  binding = require(name);',
      '} catch (err) {',
      '  handleError(err);',
      '  throw new Error(`Failed to load @parcel/watcher native binding for ${name}. Please ensure the platform-specific package is installed. Original error: ${err.message}`);',
      '}',
      '',
      ''
    ].join('\n')

    const patchedContent = before + patchedBlock + after
    fs.writeFileSync(indexPath, patchedContent, 'utf-8')
    console.log('[afterPack] ✅ Patched @parcel/watcher/index.js - removed build/Release fallback')
  } catch (err) {
    console.warn(`[afterPack] ⚠️ Failed to patch @parcel/watcher/index.js: ${err.message}`)
  }
}

/**
 * 验证目标平台+架构的 @parcel/watcher 原生二进制包存在
 *
 * 注意：Linux 的包名带 libc 后缀（-glibc / -musl），
 * 这里通过前缀匹配 + arch 后缀匹配来查找。
 *
 * @param {string} parcelDir - @parcel 目录路径
 * @param {string} platform - mac / win / linux
 * @param {string} arch - x64 / ia32 / arm64 / arm
 */
function verifyPlatformWatcherBinary(parcelDir, platform, arch) {
  const platformPrefixMap = {
    mac: 'watcher-darwin-',
    win: 'watcher-win32-',
    linux: 'watcher-linux-',
  }

  const prefix = platformPrefixMap[platform]
  if (!prefix) return

  // 目标包名规则：watcher-{platform}-{arch}（Linux 还可能有 -glibc/-musl 后缀）
  // 在 @parcel 目录下查找匹配 prefix + arch 的包
  const foundPackages = []
  const missingPackages = []

  try {
    const entries = fs.readdirSync(parcelDir)
    const matchedEntries = entries.filter(entry =>
      entry.startsWith(prefix) && entry.endsWith('-' + arch)
    )

    if (matchedEntries.length === 0) {
      // 没有精确匹配（可能是 Linux 的 -glibc/-musl 后缀情况）
      // 尝试查找包含 arch 的包
      const archEntries = entries.filter(entry =>
        entry.startsWith(prefix) && entry.includes('-' + arch)
      )
      if (archEntries.length > 0) {
        for (const entry of archEntries) {
          const nodeFile = path.join(parcelDir, entry, 'watcher.node')
          if (fs.existsSync(nodeFile)) {
            foundPackages.push(`${entry} (${arch})`)
          } else {
            missingPackages.push(`${entry} (${arch})`)
          }
        }
      } else {
        missingPackages.push(`${prefix}**-${arch} (期望的目标包)`)
      }
    } else {
      for (const entry of matchedEntries) {
        const nodeFile = path.join(parcelDir, entry, 'watcher.node')
        if (fs.existsSync(nodeFile)) {
          foundPackages.push(`${entry} (${arch})`)
        } else {
          missingPackages.push(`${entry} (${arch}) - watcher.node 缺失`)
        }
      }
    }
  } catch (err) {
    console.warn(`[afterPack] ⚠️ Failed to verify watcher binary: ${err.message}`)
    return
  }

  if (foundPackages.length > 0) {
    console.log(`[afterPack] ✅ Platform watcher binary verified for ${platform}-${arch}: ${foundPackages.join(', ')}`)
  }

  if (missingPackages.length > 0) {
    console.warn(`[afterPack] ⚠️ Missing watcher binary for ${platform}-${arch}: ${missingPackages.join(', ')}`)
    console.warn('[afterPack] ⚠️ The app may fail to load @parcel/watcher on target platform!')
  }
}

/**
 * 清理 @xenova/transformers 中的模型文件（大文件，运行时按需下载）
 */
function cleanXenovaModels(appDir) {
  const modelsDir = path.join(appDir, 'node_modules', '@xenova', 'transformers', 'models')
  if (!fs.existsSync(modelsDir)) return 0
  // 删除预置模型文件，运行时会自动下载
  return rmRecursive(modelsDir)
}

/**
 * 判断当前构建的目标平台和架构
 * @returns {{platform: string, arch: string}}
 */
function detectPlatform(buildResult) {
  const platform = buildResult.electronPlatformName
    || buildResult.platform
    || process.platform

  let normalizedPlatform = 'linux'
  if (platform === 'darwin' || platform === 'mac') normalizedPlatform = 'mac'
  else if (platform === 'win32' || platform === 'win') normalizedPlatform = 'win'

  // 获取目标架构（electron-builder context 中可能在不同字段提供）
  // 优先级：buildResult.arch > packager.arch > process.arch
  const arch = buildResult.arch
    || buildResult.packager?.arch
    || buildResult.options?.arch
    || process.arch

  return { platform: normalizedPlatform, arch }
}

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir
  const { platform, arch } = detectPlatform(context)

  // 查找 resources 目录
  let resourcesDir = null

  if (platform === 'mac') {
    const appName = context.packager.appInfo.productFilename || 'AweeClaw'
    const macResources = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources')
    if (fs.existsSync(macResources)) {
      resourcesDir = macResources
    }
  }

  if (!resourcesDir) {
    const winLinResources = path.join(appOutDir, 'resources')
    if (fs.existsSync(winLinResources)) {
      resourcesDir = winLinResources
    }
  }

  if (!resourcesDir) {
    console.log('[afterPack] Resources directory not found, skipping cleanup')
    return
  }

  let totalRemoved = 0

  // 清理 asar.unpacked 中的跨平台二进制和不需要的文件
  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked')
  if (fs.existsSync(unpackedDir)) {
    totalRemoved += cleanOnnxRuntime(unpackedDir, platform)
    totalRemoved += cleanLanceDB(unpackedDir, platform)
    totalRemoved += cleanSharp(unpackedDir, platform)
    totalRemoved += cleanParcelWatcher(unpackedDir, platform, arch)
    totalRemoved += cleanXenovaModels(unpackedDir)
  }

  if (totalRemoved > 0) {
    const removedMB = (totalRemoved / 1024 / 1024).toFixed(1)
    console.log(`[afterPack] Total cleaned for ${platform}: removed ${removedMB}MB`)
  } else {
    console.log(`[afterPack] No cleanup needed for ${platform}`)
  }
}
