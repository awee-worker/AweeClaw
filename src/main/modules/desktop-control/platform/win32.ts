/**
 * Windows 平台适配器实现
 * 使用 PowerShell / 注册表 / Win32 API
 */

import { shell, screen, desktopCapturer } from 'electron'
import * as cp from 'child_process'
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

/** 执行 PowerShell 命令 */
function execPowerShell(command: string, options?: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const fullCmd = `powershell -NoProfile -NonInteractive -Command "${command.replace(/"/g, '\\"')}"`
    cp.exec(fullCmd, { maxBuffer: 10 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) {
        reject(err)
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
      }
    })
  })
}

/** 执行普通命令 */
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

export class Win32PlatformAdapter implements PlatformAdapter {
  private appsCache: AppInfo[] | null = null
  private appsCacheTime = 0
  private static readonly CACHE_TTL = 5 * 60 * 1000

  async launchApp(name: string, args?: string[]): Promise<LaunchResult> {
    const start = Date.now()
    try {
      const appInfo = await this.findApp(name)
      const target = appInfo?.executablePath || name

      // 使用 Start-Process 启动
      const argStr = args && args.length > 0 ? ` -ArgumentList '${args.join("','")}'` : ''
      await execPowerShell(`Start-Process -FilePath '${target}'${argStr}`)

      // 获取 PID
      let pid: number | undefined
      try {
        const { stdout } = await execPowerShell(
          `Get-Process | Where-Object { $_.ProcessName -like '*${name}*' } | Select-Object -First 1 -ExpandProperty Id`,
        )
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
      logger.desktop?.error?.('[Win32] launchApp failed:', err)
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
      await execPowerShell(
        `Get-Process | Where-Object { $_.ProcessName -like '*${name}*' } | Stop-Process -Force`,
      )
      return {
        success: true,
        operation: 'quitApp',
        target: name,
        duration: Date.now() - start,
      }
    } catch (err) {
      logger.desktop?.error?.('[Win32] quitApp failed:', err)
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
    if (this.appsCache && Date.now() - this.appsCacheTime < Win32PlatformAdapter.CACHE_TTL) {
      return this.appsCache
    }

    const apps: AppInfo[] = []
    const seen = new Set<string>()

    try {
      // 从注册表读取已安装应用（64位 + 32位）
      const regKeys = [
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      ]

      const psCmd = `$keys = @(${regKeys.map(k => `Get-ItemProperty '${k}'`).join(', ')}); $keys | Where-Object { $_.DisplayName -and $_.InstallLocation } | Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString | ConvertTo-Json`

      const { stdout } = await execPowerShell(psCmd)
      const trimmed = stdout.trim()
      if (trimmed) {
        const list = JSON.parse(trimmed)
        const arr = Array.isArray(list) ? list : [list]
        for (const item of arr) {
          const name = item.DisplayName
          const installLoc = item.InstallLocation
          if (!name || !installLoc || seen.has(name)) continue
          seen.add(name)

          // 查找主可执行文件
          let execPath = installLoc
          try {
            const filesResult = await execPowerShell(
              `Get-ChildItem -Path '${installLoc}' -Filter '*.exe' -File | Select-Object -First 1 -ExpandProperty FullName`,
            )
            const filePath = filesResult.stdout.trim()
            if (filePath) execPath = filePath
          } catch {
            // 忽略
          }

          apps.push({
            name,
            executablePath: execPath,
            version: item.DisplayVersion,
            publisher: item.Publisher,
            categories: ['Productivity'],
          })
        }
      }

      this.appsCache = apps
      this.appsCacheTime = Date.now()
      return apps
    } catch (err) {
      logger.desktop?.error?.('[Win32] listInstalledApps failed:', err)
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
      await execCmd(`start "" "${filePath}"`)
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
      logger.desktop?.error?.('[Win32] getSystemInfo failed:', err)
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
      logger.desktop?.error?.('[Win32] listProcesses failed:', err)
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
      // 使用 CoreAudioApi via PowerShell
      await execPowerShell(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinMM { [DllImport("winmm.dll")] public static extern int waveOutSetVolume(IntPtr hwo, uint dwVolume); }'; [WinMM]::waveOutSetVolume([IntPtr]::Zero, [uint32](${Math.round(vol * 65535 / 100)}) -bor (${Math.round(vol * 65535 / 100)} -shl 16))`,
      )
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
      // 使用 WMI 调整亮度
      await execPowerShell(
        `Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods | ForEach-Object { $_.WmiSetBrightness(1, ${lvl / 100}) }`,
      )
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
      const { stdout } = await execPowerShell(
        `Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object Id, ProcessName, MainWindowTitle, MainWindowHandle | ConvertTo-Json`,
      )
      const text = stdout.toString().trim()
      if (!text) return []

      let processes: any[] = []
      try {
        const parsed = JSON.parse(text)
        processes = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        return []
      }

      const windows: WindowInfo[] = processes.map(p => ({
        id: `${p.ProcessName}:${p.MainWindowHandle}`,
        title: p.MainWindowTitle || p.ProcessName,
        appName: p.ProcessName,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        isFocused: false,
        isMinimized: false,
        isMaximized: false,
        pid: p.Id,
      }))

      logger.desktop.info(`[Win32] listWindows count=${windows.length} duration=${Date.now() - start}ms`)
      return windows
    } catch (err) {
      logger.desktop.error('[Win32] listWindows failed:', err)
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

  async performWindowAction(
    windowId: string,
    action: WindowActionType,
    bounds?: Rect,
  ): Promise<ActionResult> {
    const start = Date.now()
    try {
      const [, handleStr] = windowId.split(':')
      const handle = parseInt(handleStr, 10)
      if (!handle) throw new Error(`Invalid window handle: ${windowId}`)

      let script = ''
      switch (action) {
        case 'focus':
        case 'bringToFront':
          script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }'; [W]::SetForegroundWindow([IntPtr]::new(${handle}))`
          break
        case 'minimize':
          script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); }'; [W]::ShowWindow([IntPtr]::new(${handle}), 6)`
          break
        case 'maximize':
          script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); }'; [W]::ShowWindow([IntPtr]::new(${handle}), 3)`
          break
        case 'restore':
          script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); }'; [W]::ShowWindow([IntPtr]::new(${handle}), 9)`
          break
        case 'close':
          script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'; [W]::PostMessage([IntPtr]::new(${handle}), 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)`
          break
        case 'setBounds':
          if (!bounds) throw new Error('bounds required for setBounds')
          script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int h, bool r); }'; [W]::MoveWindow([IntPtr]::new(${handle}), ${bounds.x}, ${bounds.y}, ${bounds.width}, ${bounds.height}, $true)`
          break
        default:
          throw new Error(`Unsupported window action: ${action}`)
      }

      await execPowerShell(script, { timeout: 5000 })

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
    const start = Date.now()
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
      logger.desktop.error('[Win32] captureScreen failed:', err)
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
      const buttonFlag = params.button === 'right' ? 'right' : 'left'
      const clickCount = params.clickType === 'double' ? 2 : 1
      const downCode = params.button === 'right' ? '0x0008' : '0x0002'
      const upCode = params.button === 'right' ? '0x0010' : '0x0004'
      const clickEvents = Array(clickCount).fill(`[M]::mouse_event(${downCode}, 0, 0, 0, 0); [M]::mouse_event(${upCode}, 0, 0, 0, 0)`).join(' ')
      const script = `
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M {
          [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
          [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
        }'
        [M]::SetCursorPos(${params.x}, ${params.y})
        ${clickEvents}
      `
      await execPowerShell(script, { timeout: 5000 })
      return { success: true, operation: 'mouseClick', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'mouseClick', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async mouseMove(params: MouseMoveParams): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const script = `
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }'
        [M]::SetCursorPos(${params.x}, ${params.y})
      `
      await execPowerShell(script, { timeout: 5000 })
      return { success: true, operation: 'mouseMove', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'mouseMove', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async mouseScroll(params: MouseScrollParams): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const script = `
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M {
          [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
        }'
        [M]::mouse_event(0x0800, 0, 0, ${params.amount * 120}, 0)
      `
      await execPowerShell(script, { timeout: 5000 })
      return { success: true, operation: 'mouseScroll', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'mouseScroll', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async mouseDrag(params: MouseDragParams): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const downFlag = params.button === 'right' ? '0x0008' : '0x0002'
      const upFlag = params.button === 'right' ? '0x0010' : '0x0004'
      const script = `
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M {
          [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
          [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
        }'
        [M]::SetCursorPos(${params.fromX}, ${params.fromY})
        [M]::mouse_event(${downFlag}, 0, 0, 0, 0)
        [M]::SetCursorPos(${params.toX}, ${params.toY})
        [M]::mouse_event(${upFlag}, 0, 0, 0, 0)
      `
      await execPowerShell(script, { timeout: 10000 })
      return { success: true, operation: 'mouseDrag', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'mouseDrag', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async typeText(text: string, delayMs = 0): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const escaped = text.replace(/'/g, "''").replace(/"/g, '`"')
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait("${escaped}")
      `
      await execPowerShell(script, { timeout: 10000 })
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
      return { success: true, operation: 'typeText', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'typeText', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async pressKey(key: string): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const keyMap: Record<string, string> = {
        enter: '{ENTER}',
        tab: '{TAB}',
        escape: '{ESC}',
        backspace: '{BACKSPACE}',
        delete: '{DELETE}',
        up: '{UP}',
        down: '{DOWN}',
        left: '{LEFT}',
        right: '{RIGHT}',
        home: '{HOME}',
        end: '{END}',
        pageup: '{PGUP}',
        pagedown: '{PGDN}',
        space: ' ',
      }
      const mapped = keyMap[key.toLowerCase()] || key
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait("${mapped}")
      `
      await execPowerShell(script, { timeout: 5000 })
      return { success: true, operation: 'pressKey', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'pressKey', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async keyCombo(keys: string[]): Promise<InputOperationResult> {
    const start = Date.now()
    try {
      const modifierMap: Record<string, string> = {
        ctrl: '^',
        control: '^',
        shift: '+',
        alt: '%',
        cmd: '^',
        command: '^',
      }
      const normalKeys = keys.filter(k => !modifierMap[k.toLowerCase()])
      const modifiers = keys.filter(k => modifierMap[k.toLowerCase()]).map(k => modifierMap[k.toLowerCase()])

      if (normalKeys.length === 0) throw new Error('Key combo requires non-modifier key')

      const combo = modifiers.join('') + normalKeys[0]
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait("${combo}")
      `
      await execPowerShell(script, { timeout: 5000 })
      return { success: true, operation: 'keyCombo', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'keyCombo', error: (err as Error).message, duration: Date.now() - start }
    }
  }
}
