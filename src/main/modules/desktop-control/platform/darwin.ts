/**
 * macOS 平台适配器实现
 * 使用 NSWorkspace / AppleScript / mdfind 等原生能力
 */

import { app, shell, screen, desktopCapturer } from 'electron'
import * as cp from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import si from 'systeminformation'
import psList from 'ps-list'
import { logger } from '@shared/toolkit/LogEngine'
import type { PlatformAdapter } from './types'
import type {
  AppInfo,
  ProcessInfo,
  SystemInfo,
  LaunchResult,
  ActionResult,
  WindowInfo,
  WindowActionType,
  ScreenshotResult,
  Rect,
  MouseClickParams,
  MouseMoveParams,
  MouseScrollParams,
  MouseDragParams,
  InputOperationResult,
} from '../types/actions'

/** 执行 shell 命令的便捷封装 */
function execCmd(command: string, options?: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    cp.exec(command, { maxBuffer: 10 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) {
        reject(err)
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
      }
    })
  })
}

/**
 * 通过 -e 参数逐行执行 AppleScript（最可靠方式）
 *
 * 优势：
 * - 每个 -e 是一行，osascript 自动组合成完整脚本，保留多行结构
 * - 不需要临时文件，不需要 stdin
 * - execFile 直接调用，不经过 shell，无需转义引号
 * - 实测简单脚本 2 秒内完成，不会超时
 *
 * 使用方式：
 *   execAppleScriptLines([
 *     'tell application "System Events"',
 *     'set x to ...',
 *     'end tell',
 *   ])
 */
function execAppleScriptLines(lines: string[], timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const args: string[] = []
    for (const line of lines) {
      args.push('-e', line)
    }
    cp.execFile('/usr/bin/osascript', args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const stderrText = stderr ? stderr.toString().trim() : ''
        reject(new Error(stderrText || err.message))
      } else {
        resolve(stdout.toString().trim())
      }
    })
  })
}

/** 提取应用图标为 base64（简化版，仅返回路径） */
function extractAppIcon(appPath: string): string | undefined {
  try {
    const infoPlist = path.join(appPath, 'Contents', 'Info.plist')
    if (fs.existsSync(infoPlist)) {
      // 简化：直接返回 .icns 路径，由前端处理
      const resourcesDir = path.join(appPath, 'Contents', 'Resources')
      if (fs.existsSync(resourcesDir)) {
        const files = fs.readdirSync(resourcesDir)
        const icns = files.find(f => f.endsWith('.icns'))
        if (icns) return path.join(resourcesDir, icns)
      }
    }
  } catch {
    // 忽略错误
  }
  return undefined
}

/** 解析 Info.plist（简化版，仅提取关键字段） */
function parseInfoPlist(appPath: string): { name?: string; bundleId?: string; version?: string } {
  try {
    const plistPath = path.join(appPath, 'Contents', 'Info.plist')
    if (!fs.existsSync(plistPath)) return {}

    const content = fs.readFileSync(plistPath, 'utf-8')
    const nameMatch = content.match(/<key>CFBundleName<\/key>\s*<string>([^<]+)<\/string>/)
    const bundleIdMatch = content.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/)
    const versionMatch = content.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)

    return {
      name: nameMatch?.[1],
      bundleId: bundleIdMatch?.[1],
      version: versionMatch?.[1],
    }
  } catch {
    return {}
  }
}

export class DarwinPlatformAdapter implements PlatformAdapter {
  /** 已安装应用缓存 */
  private appsCache: AppInfo[] | null = null
  private appsCacheTime = 0
  private static readonly CACHE_TTL = 5 * 60 * 1000 // 5 分钟

  async launchApp(name: string, args?: string[]): Promise<LaunchResult> {
    const start = Date.now()
    try {
      // 1. 尝试按应用名启动：open -a "App Name"
      const appInfo = await this.findApp(name)
      const target = appInfo?.executablePath || name

      const cmd = args && args.length > 0
        ? `open -a "${target}" --args ${args.map(a => `"${a}"`).join(' ')}`
        : `open -a "${target}"`

      await execCmd(cmd)

      // 2. 获取启动后的 PID（通过 app 名查找进程）
      let pid: number | undefined
      try {
        const { stdout } = await execCmd(`pgrep -f "${name}" | head -1`)
        pid = parseInt(stdout.trim(), 10) || undefined
      } catch {
        // pgrep 可能找不到，忽略
      }

      return {
        success: true,
        pid,
        duration: Date.now() - start,
      }
    } catch (err) {
      logger.desktop?.error?.('[Darwin] launchApp failed:', err)
      return {
        success: false,
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async quitApp(name: string): Promise<ActionResult> {
    const start = Date.now()
    try {
      // 使用 AppleScript 优雅退出
      await execCmd(`osascript -e 'tell application "${name}" to quit'`)
      return {
        success: true,
        operation: 'quitApp',
        target: name,
        duration: Date.now() - start,
      }
    } catch (err) {
      // AppleScript 失败时尝试 kill
      try {
        await execCmd(`pkill -f "${name}"`)
        return {
          success: true,
          operation: 'quitApp',
          target: name,
          duration: Date.now() - start,
        }
      } catch (err2) {
        logger.desktop?.error?.('[Darwin] quitApp failed:', err2)
        return {
          success: false,
          operation: 'quitApp',
          target: name,
          error: (err2 as Error).message,
          duration: Date.now() - start,
        }
      }
    }
  }

  async listInstalledApps(): Promise<AppInfo[]> {
    // 命中缓存
    if (this.appsCache && Date.now() - this.appsCacheTime < DarwinPlatformAdapter.CACHE_TTL) {
      return this.appsCache
    }

    const apps: AppInfo[] = []
    const seen = new Set<string>()

    try {
      // 1. 扫描 /Applications 目录
      const appsDirs = ['/Applications', path.join(app.getPath('home'), 'Applications')]
      for (const appsDir of appsDirs) {
        if (!fs.existsSync(appsDir)) continue
        const entries = fs.readdirSync(appsDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.name.endsWith('.app')) continue
          const fullPath = path.join(appsDir, entry.name)
          if (seen.has(fullPath)) continue
          seen.add(fullPath)

          const plist = parseInfoPlist(fullPath)
          const appName = plist.name || entry.name.replace('.app', '')
          apps.push({
            name: appName,
            bundleId: plist.bundleId,
            executablePath: fullPath,
            iconPath: extractAppIcon(fullPath),
            version: plist.version,
            categories: ['Productivity'], // macOS 无统一分类，默认 Productivity
          })
        }
      }

      // 2. 通过 mdfind 补充系统应用（如 Safari、Mail 等）
      try {
        const { stdout } = await execCmd('mdfind "kMDItemContentType == \'com.apple.application-bundle\'" -onlyin /System/Applications 2>/dev/null')
        const lines = stdout.trim().split('\n').filter(Boolean)
        for (const line of lines) {
          if (seen.has(line)) continue
          seen.add(line)
          const plist = parseInfoPlist(line)
          apps.push({
            name: plist.name || path.basename(line, '.app'),
            bundleId: plist.bundleId,
            executablePath: line,
            iconPath: extractAppIcon(line),
            version: plist.version,
            categories: ['System'],
          })
        }
      } catch {
        // mdfind 失败不影响主流程
      }

      this.appsCache = apps
      this.appsCacheTime = Date.now()
      return apps
    } catch (err) {
      logger.desktop?.error?.('[Darwin] listInstalledApps failed:', err)
      return apps
    }
  }

  async findApp(name: string): Promise<AppInfo | null> {
    const apps = await this.listInstalledApps()
    // 精确匹配优先，其次包含匹配
    const exact = apps.find(a => a.name.toLowerCase() === name.toLowerCase())
    if (exact) return exact
    const partial = apps.find(a => a.name.toLowerCase().includes(name.toLowerCase()))
    return partial || null
  }

  async openUrl(url: string): Promise<ActionResult> {
    const start = Date.now()
    try {
      await shell.openExternal(url)
      return {
        success: true,
        operation: 'openUrl',
        target: url,
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'openUrl',
        target: url,
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async openFile(filePath: string): Promise<ActionResult> {
    const start = Date.now()
    try {
      await execCmd(`open "${filePath}"`)
      return {
        success: true,
        operation: 'openFile',
        target: filePath,
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'openFile',
        target: filePath,
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async getSystemInfo(): Promise<SystemInfo> {
    try {
      const [cpu, mem, osInfo, graphics, net, battery] = await Promise.all([
        si.cpu(),
        si.mem(),
        si.osInfo(),
        si.graphics(),
        si.networkInterfaces(),
        si.battery(),
      ])

      // CPU 使用率（异步，需单独采样）
      let cpuUsage = 0
      try {
        const load = await si.currentLoad()
        cpuUsage = load.currentLoad || 0
      } catch {
        // 忽略
      }

      const activeNet = net.find(n => n.operstate === 'up' && !n.internal)

      return {
        platform: process.platform,
        osVersion: `${osInfo.distro} ${osInfo.release}`,
        hostname: osInfo.hostname,
        cpu: {
          model: cpu.manufacturer + ' ' + cpu.brand,
          cores: cpu.cores,
          usage: cpuUsage,
        },
        memory: {
          total: mem.total,
          free: mem.free,
          used: mem.active,
        },
        disk: {
          // fsSize 异步较慢，简化为 0，由前端单独查询
          total: 0,
          free: 0,
        },
        displays: graphics.displays.map((d, i) => ({
          id: i,
          bounds: { x: d.positionX || 0, y: d.positionY || 0, width: d.resolutionX || 0, height: d.resolutionY || 0 },
          scaleFactor: 1,
        })),
        network: {
          ip: activeNet?.ip4 || '',
          connected: !!activeNet,
        },
        power: {
          batteryLevel: battery.hasBattery ? battery.percent : undefined,
          charging: battery.hasBattery ? battery.isCharging : false,
        },
      }
    } catch (err) {
      logger.desktop?.error?.('[Darwin] getSystemInfo failed:', err)
      throw err
    }
  }

  async listProcesses(): Promise<ProcessInfo[]> {
    try {
      const list = await psList()
      return list.map(p => ({
        pid: p.pid,
        name: p.name,
        cpuUsage: p.cpu || 0,
        memoryUsage: p.memory || 0,
        command: p.cmd,
      }))
    } catch (err) {
      logger.desktop?.error?.('[Darwin] listProcesses failed:', err)
      return []
    }
  }

  async findProcess(query: string | number): Promise<ProcessInfo[]> {
    const all = await this.listProcesses()
    if (typeof query === 'number') {
      return all.filter(p => p.pid === query)
    }
    const lower = query.toLowerCase()
    return all.filter(p =>
      p.name.toLowerCase().includes(lower) ||
      (p.command || '').toLowerCase().includes(lower),
    )
  }

  async killProcess(pid: number, force = false): Promise<ActionResult> {
    const start = Date.now()
    try {
      const signal = force ? 'SIGKILL' : 'SIGTERM'
      process.kill(pid, signal)
      return {
        success: true,
        operation: 'killProcess',
        target: String(pid),
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'killProcess',
        target: String(pid),
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async setVolume(volume: number): Promise<ActionResult> {
    const start = Date.now()
    try {
      // 0-100 范围转换为 0-7（macOS 系统音量等级）
      const vol = Math.max(0, Math.min(100, volume))
      const macVol = Math.round((vol / 100) * 7)
      await execCmd(`osascript -e 'set volume ${macVol}'`)
      return {
        success: true,
        operation: 'setVolume',
        target: String(volume),
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'setVolume',
        target: String(volume),
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async setBrightness(level: number): Promise<ActionResult> {
    const start = Date.now()
    try {
      // macOS 需要额外权限或第三方工具，简化为提示
      // 真实实现可调用 brightness npm 包或 osascript
      logger.desktop?.warn?.('[Darwin] setBrightness requires additional permission, skipping')
      return {
        success: false,
        operation: 'setBrightness',
        target: String(level),
        error: 'macOS brightness control requires accessibility permission',
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'setBrightness',
        target: String(level),
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  // ========== L4 窗口控制 ==========

  async listWindows(): Promise<WindowInfo[]> {
    const start = Date.now()
    try {
      // 使用 Electron 内置 desktopCapturer API 获取窗口列表
      // 优势：
      // 1. 无需辅助功能/自动化权限，不会触发 SIGTERM 超时
      // 2. 不依赖 osascript，避免 AppleScript 在 Electron 中的各种不稳定问题
      // 3. 内置 API，性能稳定
      // 劣势：拿不到 appName 和 bounds，需要用 osascript 仅获取应用名做补充
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        fetchWindowIcons: false,
      })

      // desktopCapturer 在 macOS 上不提供 appName（ownerName）和 bounds
      // 如需这些信息，可后续用 osascript 补充（但实测 osascript 在 Electron 中易超时）
      const windows: WindowInfo[] = sources.map((source, idx) => {
        // source.id 格式: "window:xxxxx" 或 "window:xxxxx:0"
        // source.name 是窗口标题
        const title = source.name || `Window ${idx}`
        return {
          id: source.id,
          title,
          appName: '',
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          isFocused: false,
          isMinimized: false,
          isMaximized: false,
          pid: 0,
        }
      })

      logger.desktop.info(`[Darwin] listWindows count=${windows.length} duration=${Date.now() - start}ms`)
      return windows
    } catch (err) {
      const errMsg = (err as Error).message || String(err)
      logger.desktop.error('[Darwin] listWindows failed:', errMsg)
      throw err
    }
  }

  async findWindow(query: string): Promise<WindowInfo[]> {
    const all = await this.listWindows()
    const q = query.toLowerCase()
    return all.filter(
      w =>
        w.title.toLowerCase().includes(q) || w.appName.toLowerCase().includes(q),
    )
  }

  async performWindowAction(
    windowId: string,
    action: WindowActionType,
    bounds?: Rect,
  ): Promise<ActionResult> {
    const start = Date.now()
    try {
      // 先通过 windowId 查找窗口信息，拿到 title
      // （desktopCapturer 的 source.id 格式是 "window:xxx:0"，无法直接提取 appName）
      const allWindows = await this.listWindows()
      const target = allWindows.find(w => w.id === windowId)
      if (!target) {
        throw new Error(`Window not found: ${windowId}`)
      }
      const { title, appName } = target

      // 空标题检查（desktopCapturer 可能返回空标题）
      if (!title) {
        throw new Error('Window has no title, cannot perform action')
      }

      // 转义 AppleScript 字符串中的双引号和反斜杠
      const escTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const escAppName = appName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

      // 用 -e 参数逐行执行 AppleScript（避免单行语法错误 + 避免超时）
      // 脚本结构：遍历所有前台进程，查找标题匹配的窗口，执行操作
      // 关键：保存 targetProc 引用，聚焦/置顶时激活进程为 frontmost
      //
      // 匹配策略：用 contains 模糊匹配（desktopCapturer 和 AppleScript 返回的标题可能不完全一致）
      // 例如 desktopCapturer 可能返回 "宝塔Linux面板"，而 AppleScript 返回 "宝塔Linux面板 - Google Chrome"
      const lines: string[] = [
        'tell application "System Events"',
        '  set targetWin to missing value',
        '  set targetProc to missing value',
        '  repeat with p in (every process whose background only is false)',
        '    try',
        `      set winList to every window of p whose title contains "${escTitle}"`,
        '      if (count of winList) > 0 then',
        '        set targetWin to item 1 of winList',
        '        set targetProc to p',
        '        exit repeat',
        '      end if',
        '    on error',
        '    end try',
        '  end repeat',
        '  if targetWin is not missing value then',
      ]

      switch (action) {
        case 'focus':
        case 'bringToFront':
          // 先激活进程为 frontmost，再提升窗口 Z 顺序
          lines.push('    set frontmost of targetProc to true')
          lines.push('    perform action "AXRaise" of targetWin')
          break
        case 'minimize':
          lines.push('    set miniaturized of targetWin to true')
          break
        case 'maximize':
          // macOS 没有真正的最大化，激活并提升窗口
          lines.push('    set frontmost of targetProc to true')
          lines.push('    perform action "AXRaise" of targetWin')
          break
        case 'restore':
          lines.push('    set miniaturized of targetWin to false')
          lines.push('    set frontmost of targetProc to true')
          break
        case 'close':
          // 点击关闭按钮（红色圆点）
          lines.push('    click button 1 of targetWin')
          break
        case 'setBounds':
          if (!bounds) throw new Error('bounds required for setBounds')
          if (appName) {
            lines.push(`    tell application "${escAppName}" to set bounds of front window to {${bounds.x}, ${bounds.y}, ${bounds.x + bounds.width}, ${bounds.y + bounds.height}}`)
          } else {
            throw new Error('setBounds requires appName, but desktopCapturer does not provide it')
          }
          break
        default:
          throw new Error(`Unsupported window action: ${action}`)
      }

      lines.push('    return "OK"')
      lines.push('  else')
      lines.push('    return "NOT_FOUND"')
      lines.push('  end if')
      lines.push('end tell')

      const result = await execAppleScriptLines(lines, 10000)

      if (result === 'NOT_FOUND') {
        throw new Error(`Window with title "${title}" not found in any process`)
      }

      return {
        success: true,
        operation: action,
        target: windowId,
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: action,
        target: windowId,
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  // ========== L4 屏幕截图 ==========

  async captureScreen(displayId = 0): Promise<ScreenshotResult> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      })

      const source = sources[displayId] || sources[0]
      if (!source) {
        throw new Error('No screen source available')
      }

      const dataUrl = source.thumbnail.toDataURL()
      const display = screen.getAllDisplays()[displayId] || screen.getPrimaryDisplay()

      return {
        success: true,
        dataUrl,
        region: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
        },
        displayId,
        timestamp: Date.now(),
      }
    } catch (err) {
      logger.desktop.error('[Darwin] captureScreen failed:', err)
      return {
        success: false,
        dataUrl: '',
        region: { x: 0, y: 0, width: 0, height: 0 },
        displayId,
        timestamp: Date.now(),
        error: (err as Error).message,
      }
    }
  }

  async captureRegion(region: Rect, displayId = 0): Promise<ScreenshotResult> {
    try {
      // 先截取整个屏幕，再裁剪区域
      const fullShot = await this.captureScreen(displayId)
      if (!fullShot.success) {
        return fullShot
      }

      // Electron 的 thumbnail 不支持直接裁剪，这里返回完整截图
      // 实际裁剪由前端 Canvas 处理，或使用 nativeImage.crop
      // 简化实现：返回完整截图，前端按 region 裁剪
      return {
        ...fullShot,
        region,
        timestamp: Date.now(),
      }
    } catch (err) {
      return {
        success: false,
        dataUrl: '',
        region,
        displayId,
        timestamp: Date.now(),
        error: (err as Error).message,
      }
    }
  }

  // ========== L4 输入模拟 ==========

  async mouseClick(params: MouseClickParams): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      // 使用 cliclick（需用户安装）或 AppleScript
      // AppleScript 方式：通过 System Events
      const script = `
        tell application "System Events"
          ${params.button === 'right' ? 'right click' : 'click'} at {${params.x}, ${params.y}}
        end tell
      `
      try {
        await execCmd(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 })
      } catch {
        // 回退到 cliclick
        const cmd = params.button === 'right'
          ? `cliclick -r c:${params.x},${params.y}`
          : `cliclick -c ${params.x},${params.y}`
        if (params.clickType === 'double') {
          await execCmd(`${cmd} ${cmd}`, { timeout: 5000 })
        } else {
          await execCmd(cmd, { timeout: 5000 })
        }
      }

      return {
        success: true,
        operation: 'mouseClick',
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'mouseClick',
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async mouseMove(params: MouseMoveParams): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const script = `tell application "System Events" to set position of the mouse to {${params.x}, ${params.y}}`
      try {
        await execCmd(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 })
      } catch {
        await execCmd(`cliclick m:${params.x},${params.y}`, { timeout: 5000 })
      }

      return {
        success: true,
        operation: 'mouseMove',
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'mouseMove',
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async mouseScroll(params: MouseScrollParams): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      // cliclick 支持滚动
      await execCmd(`cliclick "scroll:${params.amount},${params.amount}"`, { timeout: 5000 })

      return {
        success: true,
        operation: 'mouseScroll',
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'mouseScroll',
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async mouseDrag(params: MouseDragParams): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      // 使用 cliclick 拖拽
      const buttonFlag = params.button === 'right' ? 'r' : 'l'
      await execCmd(
        `cliclick -${buttonFlag} dd:${params.fromX},${params.fromY} du:${params.toX},${params.toY}`,
        { timeout: 10000 },
      )

      return {
        success: true,
        operation: 'mouseDrag',
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'mouseDrag',
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async typeText(text: string, delayMs = 0): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      // 转义文本中的特殊字符
      const escaped = text.replace(/"/g, '\\"').replace(/\\/g, '\\\\')
      const script = `tell application "System Events" to keystroke "${escaped}"`
      await execCmd(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 10000 })

      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

      return {
        success: true,
        operation: 'typeText',
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'typeText',
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async pressKey(key: string): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const script = `tell application "System Events" to key code ${this.keyToKeyCode(key)}`
      await execCmd(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 })

      return {
        success: true,
        operation: 'pressKey',
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'pressKey',
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async keyCombo(keys: string[]): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      // 使用 keystroke 组合键
      const modifiers = keys.filter(k => this.isModifier(k)).map(k => this.modifierName(k))
      const normalKeys = keys.filter(k => !this.isModifier(k))

      if (normalKeys.length === 0) {
        throw new Error('Key combo requires at least one non-modifier key')
      }

      let script: string
      if (modifiers.length > 0) {
        script = `tell application "System Events" to keystroke "${normalKeys[0]}" using {${modifiers.join(', ')}}`
      } else {
        script = `tell application "System Events" to keystroke "${normalKeys[0]}"`
      }

      await execCmd(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 })

      return {
        success: true,
        operation: 'keyCombo',
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'keyCombo',
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  /** 按键名转 macOS key code */
  private keyToKeyCode(key: string): number {
    const keyMap: Record<string, number> = {
      enter: 36,
      return: 36,
      tab: 48,
      space: 49,
      delete: 51,
      escape: 53,
      escapekey: 53,
      f1: 122,
      f2: 120,
      f3: 99,
      f4: 118,
      f5: 96,
      f6: 97,
      f7: 98,
      f8: 100,
      f9: 101,
      f10: 109,
      f11: 103,
      f12: 111,
      home: 115,
      end: 119,
      pageup: 116,
      pagedown: 121,
      leftarrow: 123,
      rightarrow: 124,
      downarrow: 125,
      uparrow: 126,
      a: 0,
      b: 11,
      c: 8,
      d: 2,
      e: 14,
      f: 3,
      g: 5,
      h: 4,
      i: 34,
      j: 38,
      k: 40,
      l: 37,
      m: 46,
      n: 45,
      o: 31,
      p: 35,
      q: 12,
      r: 15,
      s: 1,
      t: 17,
      u: 32,
      v: 9,
      w: 13,
      x: 7,
      y: 16,
      z: 6,
      0: 29,
      1: 18,
      2: 19,
      3: 20,
      4: 21,
      5: 23,
      6: 22,
      7: 26,
      8: 28,
      9: 25,
    }
    return keyMap[key.toLowerCase()] ?? 0
  }

  /** 判断是否为修饰键 */
  private isModifier(key: string): boolean {
    const k = key.toLowerCase()
    return ['cmd', 'command', 'ctrl', 'control', 'alt', 'option', 'shift', 'fn'].includes(k)
  }

  /** 修饰键转 AppleScript 名称 */
  private modifierName(key: string): string {
    const k = key.toLowerCase()
    if (k === 'cmd' || k === 'command') return 'command down'
    if (k === 'ctrl' || k === 'control') return 'control down'
    if (k === 'alt' || k === 'option') return 'option down'
    if (k === 'shift') return 'shift down'
    if (k === 'fn') return 'function down'
    return 'command down'
  }
}
