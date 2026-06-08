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
 */
function cleanParcelWatcher(appDir, platform) {
  const parcelDir = path.join(appDir, 'node_modules', '@parcel')
  if (!fs.existsSync(parcelDir)) return 0

  const keepSuffixes = PLATFORM_KEEP_MAP[platform]?.parcel || []
  let removedSize = 0

  for (const entry of fs.readdirSync(parcelDir)) {
    if (entry === 'watcher') continue
    const shouldKeep = keepSuffixes.some(suffix => entry.includes(suffix))
    if (!shouldKeep) {
      removedSize += rmRecursive(path.join(parcelDir, entry))
    }
  }

  return removedSize
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
 * 判断当前构建的目标平台
 */
function detectPlatform(buildResult) {
  const platform = buildResult.electronPlatformName
    || buildResult.platform
    || process.platform

  if (platform === 'darwin' || platform === 'mac') return 'mac'
  if (platform === 'win32' || platform === 'win') return 'win'
  return 'linux'
}

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir
  const platform = detectPlatform(context)

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
    totalRemoved += cleanParcelWatcher(unpackedDir, platform)
    totalRemoved += cleanXenovaModels(unpackedDir)

    // 清理完全不需要的模块（主进程未使用）
    // @img — sharp 图片处理库，主进程未使用
    const sharpDir = path.join(unpackedDir, 'node_modules', '@img')
    if (fs.existsSync(sharpDir)) {
      totalRemoved += rmRecursive(sharpDir)
    }
  }

  if (totalRemoved > 0) {
    const removedMB = (totalRemoved / 1024 / 1024).toFixed(1)
    console.log(`[afterPack] Total cleaned for ${platform}: removed ${removedMB}MB`)
  } else {
    console.log(`[afterPack] No cleanup needed for ${platform}`)
  }
}
