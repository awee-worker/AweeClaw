/**
 * Linux 平台适配器实现
 * 使用 xdg-open / gtk-launch / .desktop 文件解析
 */

import { shell, screen, desktopCapturer } from 'electron'
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

/** 执行 shell 命令 */
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

/** 解析 .desktop 文件 */
function parseDesktopFile(filePath: string): AppInfo | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    let inDesktopEntry = false
    let name = ''
    let exec = ''
    let icon = ''
    let categories = ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === '[Desktop Entry]') {
        inDesktopEntry = true
        continue
      }
      if (trimmed.startsWith('[') && trimmed !== '[Desktop Entry]') {
        inDesktopEntry = false
        continue
      }
      if (!inDesktopEntry) continue

      if (trimmed.startsWith('Name=')) name = trimmed.slice(5)
      else if (trimmed.startsWith('Exec=')) exec = trimmed.slice(5)
      else if (trimmed.startsWith('Icon=')) icon = trimmed.slice(5)
      else if (trimmed.startsWith('Categories=')) categories = trimmed.slice(11)
    }

    if (!name || !exec) return null

    // 清理 Exec 字段中的占位符（如 %f, %u）
    const cleanExec = exec.replace(/%[fFuUdDnNickvm]/g, '').trim()

    return {
      name,
      executablePath: cleanExec,
      iconPath: icon || undefined,
      categories: categories ? categories.split(';').filter(Boolean) : ['Application'],
    }
  } catch {
    return null
  }
}

export class LinuxPlatformAdapter implements PlatformAdapter {
  private appsCache: AppInfo[] | null = null
  private appsCacheTime = 0
  private static readonly CACHE_TTL = 5 * 60 * 1000

  async launchApp(name: string, args?: string[]): Promise<LaunchResult> {
    const start = Date.now()
    try {
      const appInfo = await this.findApp(name)
      let cmd: string

      if (appInfo?.executablePath) {
        // 使用 .desktop 文件中的 Exec
        const argStr = args && args.length > 0 ? ' ' + args.map(a => `"${a}"`).join(' ') : ''
        cmd = `${appInfo.executablePath}${argStr} &`
      } else {
        // 尝试 gtk-launch 或直接执行
        const argStr = args && args.length > 0 ? ' ' + args.map(a => `"${a}"`).join(' ') : ''
        cmd = `gtk-launch "${name}"${argStr} 2>/dev/null || "${name}"${argStr} &`
      }

      await execCmd(cmd)

      // 获取 PID
      let pid: number | undefined
      try {
        const { stdout } = await execCmd(`pgrep -f "${name}" | head -1`)
        pid = parseInt(stdout.trim(), 10) || undefined
      } catch {
        // 忽略
      }

      return {
        success: true,
        pid,
        duration: Date.now() - start,
      }
    } catch (err) {
      logger.desktop?.error?.('[Linux] launchApp failed:', err)
      return {
        success: false,
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async activateApp(name: string): Promise<ActionResult> {
    const start = Date.now()
    try {
      // Linux 下用 wmctrl 激活窗口（需安装 wmctrl）
      await execCmd(`wmctrl -a "${name}"`)
      return {
        success: true,
        operation: 'activateApp',
        target: name,
        duration: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        operation: 'activateApp',
        target: name,
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async quitApp(name: string): Promise<ActionResult> {
    const start = Date.now()
    try {
      await execCmd(`pkill -f "${name}"`)
      return {
        success: true,
        operation: 'quitApp',
        target: name,
        duration: Date.now() - start,
      }
    } catch (err) {
      logger.desktop?.error?.('[Linux] quitApp failed:', err)
      return {
        success: false,
        operation: 'quitApp',
        target: name,
        error: (err as Error).message,
        duration: Date.now() - start,
      }
    }
  }

  async listInstalledApps(): Promise<AppInfo[]> {
    if (this.appsCache && Date.now() - this.appsCacheTime < LinuxPlatformAdapter.CACHE_TTL) {
      return this.appsCache
    }

    const apps: AppInfo[] = []
    const seen = new Set<string>()

    try {
      // 扫描 .desktop 文件目录
      const desktopDirs = [
        '/usr/share/applications',
        '/usr/local/share/applications',
        path.join(process.env.HOME || '', '.local/share/applications'),
      ]

      for (const dir of desktopDirs) {
        if (!fs.existsSync(dir)) continue
        const files = fs.readdirSync(dir)
        for (const file of files) {
          if (!file.endsWith('.desktop')) continue
          const fullPath = path.join(dir, file)
          if (seen.has(fullPath)) continue
          seen.add(fullPath)

          const appInfo = parseDesktopFile(fullPath)
          if (appInfo && !apps.find(a => a.name === appInfo.name)) {
            apps.push(appInfo)
          }
        }
      }

      this.appsCache = apps
      this.appsCacheTime = Date.now()
      return apps
    } catch (err) {
      logger.desktop?.error?.('[Linux] listInstalledApps failed:', err)
      return apps
    }
  }

  async findApp(name: string): Promise<AppInfo | null> {
    const apps = await this.listInstalledApps()
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
      await execCmd(`xdg-open "${filePath}"`)
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
      logger.desktop?.error?.('[Linux] getSystemInfo failed:', err)
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
      logger.desktop?.error?.('[Linux] listProcesses failed:', err)
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
      const vol = Math.max(0, Math.min(100, volume))
      // 尝试 amixer（ALSA）或 pactl（PulseAudio）
      try {
        await execCmd(`amixer set Master ${vol}% 2>/dev/null || pactl set-sink-volume @DEFAULT_SINK@ ${vol}%`)
      } catch {
        // 忽略
      }
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
      const lvl = Math.max(0, Math.min(100, level))
      // 尝试 brightnessctl 或 xbacklight
      await execCmd(`brightnessctl set ${lvl}% 2>/dev/null || xbacklight -set ${lvl}`)
      return {
        success: true,
        operation: 'setBrightness',
        target: String(level),
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
      // 使用 wmctrl 列出窗口（需安装 wmctrl）
      const { stdout } = await execCmd('wmctrl -l -p', { timeout: 5000 })
      const lines = stdout.toString().split('\n').filter(Boolean)

      const windows: WindowInfo[] = lines.map(line => {
        const parts = line.split(/\s+/)
        const hexId = parts[0]
        const pid = parseInt(parts[2], 10) || 0
        const appName = parts.length > 4 ? parts.slice(4).join(' ') : 'Unknown'
        return {
          id: hexId,
          title: appName,
          appName,
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          isFocused: false,
          isMinimized: false,
          isMaximized: false,
          pid,
        }
      })

      logger.desktop.info(`[Linux] listWindows count=${windows.length} duration=${Date.now() - start}ms`)
      return windows
    } catch (err) {
      logger.desktop.error('[Linux] listWindows failed (wmctrl not installed?):', err)
      return []
    }
  }

  async findWindow(query: string): Promise<WindowInfo[]> {
    const all = await this.listWindows()
    const q = query.toLowerCase()
    return all.filter(
      w => w.title.toLowerCase().includes(q) || w.appName.toLowerCase().includes(q),
    )
  }

  async getActiveWindowBounds(_appName: string): Promise<Rect | null> {
    // TODO: Linux 实现可使用 xdotool getactivewindow getwindowgeometry
    return null
  }

  async performWindowAction(
    windowId: string,
    action: WindowActionType,
    bounds?: Rect,
  ): Promise<ActionResult> {
    const start = Date.now()
    try {
      let cmd = ''
      switch (action) {
        case 'focus':
        case 'bringToFront':
          cmd = `wmctrl -i -a ${windowId}`
          break
        case 'minimize':
          cmd = `wmctrl -i -r ${windowId} -b add,hidden`
          break
        case 'maximize':
          cmd = `wmctrl -i -r ${windowId} -b add,maximized_vert,maximized_horz`
          break
        case 'restore':
          cmd = `wmctrl -i -r ${windowId} -b remove,maximized_vert,maximized_horz,hidden`
          break
        case 'close':
          cmd = `wmctrl -i -c ${windowId}`
          break
        case 'setBounds':
          if (!bounds) throw new Error('bounds required for setBounds')
          cmd = `wmctrl -i -r ${windowId} -e 0,${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
          break
        default:
          throw new Error(`Unsupported window action: ${action}`)
      }

      await execCmd(cmd, { timeout: 5000 })

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
      if (!source) throw new Error('No screen source available')

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
      logger.desktop.error('[Linux] captureScreen failed:', err)
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
    const fullShot = await this.captureScreen(displayId)
    if (!fullShot.success) return fullShot
    return { ...fullShot, region, timestamp: Date.now() }
  }

  // ========== L4 输入模拟 ==========

  async mouseClick(params: MouseClickParams): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const button = params.button === 'right' ? 3 : params.button === 'middle' ? 2 : 1
      const clickCount = params.clickType === 'double' ? 2 : 1
      for (let i = 0; i < clickCount; i++) {
        await execCmd(
          `xdotool mousemove ${params.x} ${params.y} click ${button}`,
          { timeout: 5000 },
        )
      }
      return { success: true, operation: 'mouseClick', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'mouseClick', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async mouseMove(params: MouseMoveParams): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const smoothFlag = params.smooth ? '--smooth' : ''
      const durationFlag = params.duration ? `--delay ${params.duration}` : ''
      await execCmd(`xdotool mousemove ${smoothFlag} ${durationFlag} ${params.x} ${params.y}`, { timeout: 5000 })
      return { success: true, operation: 'mouseMove', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'mouseMove', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async mouseScroll(params: MouseScrollParams): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      await execCmd(`xdotool mousemove ${params.x} ${params.y} click ${params.amount > 0 ? 5 : 4}`, { timeout: 5000 })
      return { success: true, operation: 'mouseScroll', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'mouseScroll', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async mouseDrag(params: MouseDragParams): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const button = params.button === 'right' ? 3 : 1
      await execCmd(
        `xdotool mousemove ${params.fromX} ${params.fromY} mousedown ${button} mousemove ${params.toX} ${params.toY} mouseup ${button}`,
        { timeout: 10000 },
      )
      return { success: true, operation: 'mouseDrag', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'mouseDrag', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async typeText(text: string, delayMs = 0): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const escaped = text.replace(/'/g, "'\\''")
      const delayFlag = delayMs > 0 ? `--delay ${delayMs}` : ''
      await execCmd(`xdotool type ${delayFlag} '${escaped}'`, { timeout: 10000 })
      return { success: true, operation: 'typeText', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'typeText', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async pressKey(key: string): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      await execCmd(`xdotool key ${key}`, { timeout: 5000 })
      return { success: true, operation: 'pressKey', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'pressKey', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async keyCombo(keys: string[]): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const combo = keys.join('+')
      await execCmd(`xdotool key ${combo}`, { timeout: 5000 })
      return { success: true, operation: 'keyCombo', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'keyCombo', error: (err as Error).message, duration: Date.now() - start }
    }
  }
}
