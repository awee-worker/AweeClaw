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
import { bridgeClick, bridgeDrag, bridgeMove, bridgeScroll, bridgeTypeText, bridgeKeyCombo, bridgeQueryLocked } from './win32PointerBridge'

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

/**
 * 以 -EncodedCommand 执行一段多行 PowerShell 脚本
 *
 * -Command 需要把整段脚本塞进一对双引号里，脚本自身的引号、换行、here-string
 * 都要再过一层转义，写错一处就是「命令能跑但语义变了」这种最难查的故障。
 * UTF-16LE + Base64 是 PowerShell 官方为「传复杂脚本」留的通道，命令行里只出现
 * Base64 字符，脚本内容原样抵达解释器。
 */
function execPowerShellEncoded(
  script: string,
  options?: cp.ExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    cp.exec(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { maxBuffer: 10 * 1024 * 1024, windowsHide: true, ...options },
      (err, stdout, stderr) => {
        if (err) {
          reject(err)
        } else {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
        }
      },
    )
  })
}

/**
 * 降级通道用的 SendInput 定义
 *
 * 与常驻桥里那份 C# 保持同一套语义：文本按 UTF-16 码元投递（KEYEVENTF_UNICODE），
 * 组合键按顺序按下再逆序抬起。写法上刻意精简，只保留键盘入口——这条通道只负责
 * 桥不可用时的兜底，鼠标早已由桥与各自的 spawn 实现覆盖。
 */
const WIN_SENDINPUT_DEF = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AweeClawKey {
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(4)] public KEYBDINPUT ki; }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  private const uint INPUT_KEYBOARD = 1, KEYUP = 0x0002, UNICODE = 0x0004;
  private static void SendOne(INPUT input) { INPUT[] b = new INPUT[1]; b[0] = input; SendInput(1, b, Marshal.SizeOf(typeof(INPUT))); }
  private static INPUT Make(ushort vk, ushort scan, uint flags) { INPUT i = new INPUT(); i.type = INPUT_KEYBOARD; i.ki.wVk = vk; i.ki.wScan = scan; i.ki.dwFlags = flags; return i; }
  public static void KeyDown(ushort vk) { SendOne(Make(vk, 0, 0)); }
  public static void KeyUp(ushort vk) { SendOne(Make(vk, 0, KEYUP)); }
  public static void KeyCombo(ushort[] vks) { foreach (ushort vk in vks) { KeyDown(vk); } for (int i = vks.Length - 1; i >= 0; i--) { KeyUp(vks[i]); } }
  public static void TypeText(string text) {
    foreach (char c in text) {
      if (c == '\\n') { KeyCombo(new ushort[] { 0x0D }); }
      else if (c == '\\t') { KeyCombo(new ushort[] { 0x09 }); }
      else {
        SendOne(Make(0, (ushort)c, UNICODE));
        SendOne(Make(0, (ushort)c, UNICODE | KEYUP));
      }
    }
  }
}
'@`

/**
 * 按键名 → Windows 虚拟键码
 *
 * 移动端发的是可读键名（enter / tab / escape…），Windows 侧要的是 VK 值。
 * 这张表只收跨端协议里真实会出现的键，不做全键盘映射：多出来的条目没有
 * 调用方，只会变成需要长期维护的死代码。
 */
const VK_MAP: Record<string, number> = {
  enter: 0x0d,
  return: 0x0d,
  tab: 0x09,
  escape: 0x1b,
  esc: 0x1b,
  backspace: 0x08,
  delete: 0x2e,
  del: 0x2e,
  insert: 0x2d,
  space: 0x20,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  ctrl: 0x11,
  control: 0x11,
  shift: 0x10,
  alt: 0x12,
  cmd: 0x5b,
  command: 0x5b,
  meta: 0x5b,
  win: 0x5b,
}

/** 修饰键集合：组合键的判定依据 */
const MODIFIER_KEYS = new Set(['ctrl', 'control', 'shift', 'alt', 'cmd', 'command', 'meta', 'win'])

/** 单个可打印字符转虚拟键码（仅用于组合键里的字母数字） */
function charToVk(ch: string): number | null {
  if (ch.length !== 1) return null
  const upper = ch.toUpperCase()
  const code = upper.charCodeAt(0)
  // A-Z 与 0-9 在虚拟键码表里与 ASCII 大写码点重合，可直接使用
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x30 && code <= 0x39)) return code
  if (ch === ' ') return 0x20
  return null
}

/** 键名解析成虚拟键码；无法识别返回 null，由调用方决定降级或报错 */
function resolveVk(key: string): number | null {
  const lower = key.toLowerCase()
  if (VK_MAP[lower] !== undefined) return VK_MAP[lower]
  return charToVk(key)
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

  async activateApp(name: string): Promise<ActionResult> {
    const start = Date.now()
    try {
      // Windows 下用 PowerShell 激活窗口
      await execPowerShell(
        `$proc = Get-Process -Name "*${name}*" -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
        `if ($proc) { ` +
        `Add-Type -AssemblyName Microsoft.VisualBasic; ` +
        `[Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id) ` +
        `}`,
      )
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

  async getActiveWindowBounds(_appName: string): Promise<Rect | null> {
    // TODO: Windows 实现可使用 GetForegroundWindow + GetWindowRect
    return null
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
    try {
      const display = screen.getAllDisplays()[displayId] || screen.getPrimaryDisplay()
      // 与 macOS 同一口径：按该显示器的逻辑分辨率请求缩略图，截图像素坐标才与
      // 屏幕逻辑坐标一一对应（输入注入用的就是这套坐标）。
      // 固定 1920x1080 时，非 16:9 的屏幕上缩略图会被拉伸，纵向比例与屏幕不一致，
      // 移动端按比例换算出来的 y 就会系统性偏小/偏大——表现正是「点下去比光标高」。
      const logicalWidth = display.bounds.width
      const logicalHeight = display.bounds.height

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: logicalWidth, height: logicalHeight },
      })

      const source = sources[displayId] || sources[0]
      if (!source) throw new Error('No screen source available')

      // 缩略图尺寸与逻辑分辨率不一致时补一次缩放，避免换算基准与实际像素错位
      const thumbSize = source.thumbnail.getSize()
      let finalImage = source.thumbnail
      if (thumbSize.width !== logicalWidth || thumbSize.height !== logicalHeight) {
        logger.desktop.warn(
          `[Win32] Thumbnail size mismatch: got ${thumbSize.width}x${thumbSize.height}, ` +
            `expected ${logicalWidth}x${logicalHeight}, resizing...`,
        )
        finalImage = source.thumbnail.resize({ width: logicalWidth, height: logicalHeight })
      }

      const dataUrl = finalImage.toDataURL()

      return {
        success: true,
        dataUrl,
        region: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: logicalWidth,
          height: logicalHeight,
        },
        displayId,
        timestamp: Date.now(),
      }
    } catch (err) {
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
    // 常驻桥命中即返回：它已把 user32 编译过一次，单次点击是微秒级；
    // 未就绪（首次调用、桥进程被杀）时降级到下面的 spawn 通道
    if (bridgeClick(params.x, params.y, params.button ?? 'left', params.clickType ?? 'single')) {
      return { success: true, operation: 'mouseClick', duration: Date.now() - start }
    }
    try {
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
    // 移动是最高频的注入，必须走桥：spawn 一次 PowerShell 要 150~400ms，
    // 远大于手指的采样间隔，不换通道光标永远追着手指跑
    if (bridgeMove(params.x, params.y)) {
      return { success: true, operation: 'mouseMove', duration: Date.now() - start }
    }
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
    // 滚动是长文档场景下频率最高的指令，一次滚动过程要发几十条，
    // 走 spawn 通道时每条都要重新 Add-Type，排队会直接表现为「滑了不动」
    if (bridgeScroll(params.x, params.y, params.amount)) {
      return { success: true, operation: 'mouseScroll', duration: Date.now() - start }
    }
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
    if (bridgeDrag(params.fromX, params.fromY, params.toX, params.toY, params.button ?? 'left')) {
      return { success: true, operation: 'mouseDrag', duration: Date.now() - start }
    }
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
    // 常驻桥命中即返回：桥已把 SendInput 编译过一次，单段文本是毫秒级
    if (bridgeTypeText(text)) {
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
      return { success: true, operation: 'typeText', duration: Date.now() - start }
    }
    try {
      /**
       * 降级通道同样走 SendInput，不再用 System.Windows.Forms.SendKeys
       *
       * SendKeys 把 + ^ % ~ ( ) { } [ ] 解析成控制字符：密码里只要有这些符号，
       * 就会被当成修饰键或直接抛异常，用户看到的是「密码怎么输都不对」。
       * SendInput 的 UNICODE 通道按码点投递，与键盘布局和特殊字符无关。
       *
       * 文本以 Base64 传入脚本内部解码，既避开 -EncodedCommand 之外的转义，
       * 也避免把含引号、换行的原文拼进命令字符串。
       */
      const encoded = Buffer.from(text, 'utf16le').toString('base64')
      const script = [
        `$ErrorActionPreference='Stop'`,
        WIN_SENDINPUT_DEF,
        `$text=[System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${encoded}'))`,
        `[AweeClawKey]::TypeText($text)`,
      ].join('\r\n')
      // 冷启动放宽：休眠唤醒后首次加载 Add-Type 明显更慢，10s 会把正常输入判成失败
      await execPowerShellEncoded(script, { timeout: 15000 })
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
      return { success: true, operation: 'typeText', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'typeText', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async pressKey(key: string): Promise<InputOperationResult> {
    const start = Date.now()
    const vk = resolveVk(key)
    if (vk === null) {
      return { success: false, operation: 'pressKey', error: `unsupported_key: ${key}`, duration: Date.now() - start }
    }
    if (bridgeKeyCombo([vk])) {
      return { success: true, operation: 'pressKey', duration: Date.now() - start }
    }
    try {
      const script = [
        `$ErrorActionPreference='Stop'`,
        WIN_SENDINPUT_DEF,
        `[AweeClawKey]::KeyCombo([uint16[]]@(${vk}))`,
      ].join('\r\n')
      await execPowerShellEncoded(script, { timeout: 15000 })
      return { success: true, operation: 'pressKey', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'pressKey', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  async keyCombo(keys: string[]): Promise<InputOperationResult> {
    const start = Date.now()
    const vks: number[] = []
    for (const key of keys) {
      const vk = resolveVk(key)
      if (vk === null) {
        return { success: false, operation: 'keyCombo', error: `unsupported_key: ${key}`, duration: Date.now() - start }
      }
      vks.push(vk)
    }
    // 只给了修饰键没有主键：按下不抬起会把键盘卡在修饰态，直接拒绝
    if (!vks.length || vks.every((_, i) => MODIFIER_KEYS.has(keys[i].toLowerCase()))) {
      return { success: false, operation: 'keyCombo', error: 'Key combo requires non-modifier key', duration: Date.now() - start }
    }
    if (bridgeKeyCombo(vks)) {
      return { success: true, operation: 'keyCombo', duration: Date.now() - start }
    }
    try {
      const script = [
        `$ErrorActionPreference='Stop'`,
        WIN_SENDINPUT_DEF,
        `[AweeClawKey]::KeyCombo([uint16[]]@(${vks.join(',')}))`,
      ].join('\r\n')
      await execPowerShellEncoded(script, { timeout: 15000 })
      return { success: true, operation: 'keyCombo', duration: Date.now() - start }
    } catch (err) {
      return { success: false, operation: 'keyCombo', error: (err as Error).message, duration: Date.now() - start }
    }
  }

  /**
   * 当前输入桌面是否被锁屏占用
   *
   * 会话锁定时系统切到 Winlogon 安全桌面，普通用户态进程的注入到不了那里。
   * 桥可用时由桥直接问系统；桥不可用时降级到一次性脚本，两条路都失败时
   * 返回 false——宁可让注入照常尝试并给出真实错误，也不要凭猜测拦下用户的
   * 正常操作。
   */
  async isSessionLocked(): Promise<boolean> {
    const viaBridge = await bridgeQueryLocked()
    if (viaBridge !== null) return viaBridge
    try {
      const script = [
        `$ErrorActionPreference='Stop'`,
        `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class AweeClawLock{[DllImport("user32.dll",SetLastError=true)]public static extern IntPtr OpenInputDesktop(uint dwFlags,bool fInherit,uint dwDesiredAccess);[DllImport("user32.dll",SetLastError=true)]public static extern bool CloseDesktop(IntPtr h);public static bool Locked(){IntPtr h=OpenInputDesktop(0,false,0x0100);if(h==IntPtr.Zero){return true;}CloseDesktop(h);return false;}}'`,
        `if ([AweeClawLock]::Locked()) { 'LOCKED' } else { 'UNLOCKED' }`,
      ].join('\r\n')
      const { stdout } = await execPowerShellEncoded(script, { timeout: 8000 })
      return stdout.trim() === 'LOCKED'
    } catch (err) {
      logger.desktop.warn(`[Win32] 锁屏状态探测失败: ${(err as Error).message}`)
      return false
    }
  }
}
