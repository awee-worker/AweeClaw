/**
 * 系统指标采集器
 *
 * 跨平台采集 CPU/内存/磁盘/网络/进程/温度/电池 等系统指标。
 * 使用 Node.js 内置 os 模块 + 轻量差分计算，无外部依赖。
 *
 * 采集策略：
 * - CPU 使用率：基于 os.cpus() 的 idle/total 时间差分
 * - 内存：os.totalmem() / os.freemem()
 * - 磁盘：差分计算读写字节（跨平台通过 fs.statfs）
 * - 网络：差分计算 rx/tx 字节（读取 /proc/net/dev on Linux，os.networkInterfaces on others）
 * - 进程数：通过 ps 命令（跨平台兼容）
 * - 温度：macOS 调用 osx-cpu-temp（可选），其他平台返回 -1
 * - 电池：调用 powermgmt API（可选）
 *
 * @module monitoring/MetricsCollector
 */

import os from 'os'
import { execFile } from 'child_process'
import type { SystemMetrics } from './MonitoringInterface'

/** 上一轮采样的 CPU 时间快照 */
interface CpuSnapshot {
  idle: number
  total: number
  timestamp: number
}

/** 上一轮采样的 IO 时间快照（磁盘 + 网络） */
interface IoSnapshot {
  diskRead: number
  diskWrite: number
  netRx: number
  netTx: number
  timestamp: number
}

/**
 * 系统指标采集器
 *
 * 单例模式。第一次调用 collect() 时初始化基线快照，
 * 第二次起才能计算差分指标（CPU/IO 速率）。
 */
export class MetricsCollector {
  private static instance: MetricsCollector | null = null

  private lastCpu: CpuSnapshot | null = null
  private lastIo: IoSnapshot | null = null
  /** 缓存上一次的 process count，避免每 30s 调起 ps */
  private cachedProcessCount: number = 0
  private cachedProcessCountAt: number = 0

  private constructor() {}

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector()
    }
    return MetricsCollector.instance
  }

  /**
   * 采集一次系统指标
   *
   * 首次调用会返回全 0 的差分指标（CPU/IO），仅绝对值有效。
   * 第二次起所有指标有效。
   */
  async collect(): Promise<SystemMetrics> {
    const now = Date.now()

    // ===== CPU 使用率（差分计算）=====
    const cpuInfo = this.calculateCpuUsage()
    const cpuLoadAvg = os.loadavg()

    // ===== 内存 =====
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const memoryUsage = totalMem > 0 ? (usedMem / totalMem) * 100 : 0

    // ===== 磁盘 + 网络（差分计算）=====
    const ioInfo = await this.calculateIoRates(now)

    // ===== 进程数（缓存 60 秒）=====
    const processCount = await this.getProcessCount(now)

    // ===== 温度 =====
    const cpuTemperature = await this.getCpuTemperature()

    // ===== 电池 =====
    const battery = await this.getBatteryInfo()

    return {
      timestamp: now,
      cpuUsage: cpuInfo.usage,
      cpuLoadAvg1: cpuLoadAvg[0] ?? 0,
      cpuLoadAvg5: cpuLoadAvg[1] ?? 0,
      cpuLoadAvg15: cpuLoadAvg[2] ?? 0,
      memoryUsage,
      memoryAvailableMB: Math.round(freeMem / 1024 / 1024),
      memoryTotalMB: Math.round(totalMem / 1024 / 1024),
      diskUsage: await this.getDiskUsage(),
      diskIoReadKBps: ioInfo.diskReadKBps,
      diskIoWriteKBps: ioInfo.diskWriteKBps,
      networkRxKBps: ioInfo.netRxKBps,
      networkTxKBps: ioInfo.netTxKBps,
      processCount,
      cpuTemperature,
      batteryPercent: battery.percent,
      batteryCharging: battery.charging,
    }
  }

  /** 重置基线快照（用于采集器停止后重新启动） */
  resetBaseline(): void {
    this.lastCpu = null
    this.lastIo = null
    this.cachedProcessCount = 0
    this.cachedProcessCountAt = 0
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /** 计算 CPU 使用率（基于 os.cpus() 的 idle/total 时间差分） */
  private calculateCpuUsage(): { usage: number } {
    const cpus = os.cpus()
    if (!cpus || cpus.length === 0) {
      return { usage: 0 }
    }

    let totalIdle = 0
    let totalTick = 0
    for (const cpu of cpus) {
      const { user, nice, sys, idle, irq } = cpu.times
      totalTick += user + nice + sys + idle + irq
      totalIdle += idle
    }

    const current: CpuSnapshot = {
      idle: totalIdle,
      total: totalTick,
      timestamp: Date.now(),
    }

    // 首次采样无法计算差分
    if (!this.lastCpu) {
      this.lastCpu = current
      return { usage: 0 }
    }

    const idleDiff = current.idle - this.lastCpu.idle
    const totalDiff = current.total - this.lastCpu.total
    this.lastCpu = current

    if (totalDiff <= 0) return { usage: 0 }
    const usage = Math.max(0, Math.min(100, ((totalDiff - idleDiff) / totalDiff) * 100))
    return { usage: Math.round(usage * 100) / 100 }
  }

  /**
   * 计算磁盘 IO 速率与网络流量速率
   *
   * 跨平台策略：
   * - Linux: 读取 /proc/diskstats 和 /proc/net/dev
   * - macOS/Windows: 通过 system_profiler / typeperf（开销较大，因此降级为 0，仅保留 CPU/内存/磁盘使用率）
   *
   * 为保证轻量与跨平台一致性，IO 速率在 macOS/Windows 上返回 0；
   * Linux 上读取 /proc 实现精确差分。
   */
  private async calculateIoRates(now: number): Promise<{
    diskReadKBps: number
    diskWriteKBps: number
    netRxKBps: number
    netTxKBps: number
  }> {
    const platform = process.platform
    let diskRead = 0
    let diskWrite = 0
    let netRx = 0
    let netTx = 0

    if (platform === 'linux') {
      try {
        const diskStats = await this.readLinuxDiskStats()
        diskRead = diskStats.readSectors * 512
        diskWrite = diskStats.writeSectors * 512
      } catch {
        // ignore
      }

      try {
        const netStats = await this.readLinuxNetStats()
        netRx = netStats.rxBytes
        netTx = netStats.txBytes
      } catch {
        // ignore
      }
    }

    const current: IoSnapshot = {
      diskRead,
      diskWrite,
      netRx,
      netTx,
      timestamp: now,
    }

    if (!this.lastIo) {
      this.lastIo = current
      return {
        diskReadKBps: 0,
        diskWriteKBps: 0,
        netRxKBps: 0,
        netTxKBps: 0,
      }
    }

    const elapsedSec = Math.max(0.001, (current.timestamp - this.lastIo.timestamp) / 1000)
    const result = {
      diskReadKBps: Math.round((current.diskRead - this.lastIo.diskRead) / 1024 / elapsedSec),
      diskWriteKBps: Math.round((current.diskWrite - this.lastIo.diskWrite) / 1024 / elapsedSec),
      netRxKBps: Math.round((current.netRx - this.lastIo.netRx) / 1024 / elapsedSec),
      netTxKBps: Math.round((current.netTx - this.lastIo.netTx) / 1024 / elapsedSec),
    }
    this.lastIo = current
    return result
  }

  /** 读取 Linux 磁盘统计（/proc/diskstats 第一行的 sect_read/sect_write 累加） */
  private readLinuxDiskStats(): Promise<{ readSectors: number; writeSectors: number }> {
    return new Promise((resolve, reject) => {
      const fs = require('fs')
      fs.readFile('/proc/diskstats', 'utf8', (err: NodeJS.ErrnoException | null, data: string) => {
        if (err) return reject(err)
        let readSectors = 0
        let writeSectors = 0
        const lines = data.split('\n')
        for (const line of lines) {
          // /proc/diskstats 字段：major minor name reads_completed reads_merged sectors_read time_read_ms
          //                            writes_completed writes_merged sectors_written time_write_ms ...
          const parts = line.trim().split(/\s+/)
          if (parts.length < 14) continue
          // 排除分区（只统计设备，如 sda、nvme0n1）—— 设备名通常不含数字结尾
          const name = parts[2] ?? ''
          if (/\d+$/.test(name)) continue
          readSectors += parseInt(parts[5] ?? '0', 10)
          writeSectors += parseInt(parts[9] ?? '0', 10)
        }
        resolve({ readSectors, writeSectors })
      })
    })
  }

  /** 读取 Linux 网络统计（/proc/net/dev 所有接口累加，排除 lo） */
  private readLinuxNetStats(): Promise<{ rxBytes: number; txBytes: number }> {
    return new Promise((resolve, reject) => {
      const fs = require('fs')
      fs.readFile('/proc/net/dev', 'utf8', (err: NodeJS.ErrnoException | null, data: string) => {
        if (err) return reject(err)
        let rxBytes = 0
        let txBytes = 0
        const lines = data.split('\n')
        // 跳过前两行表头
        for (let i = 2; i < lines.length; i++) {
          const line = lines[i].trim()
          if (!line) continue
          const colonIdx = line.indexOf(':')
          if (colonIdx === -1) continue
          const iface = line.slice(0, colonIdx).trim()
          // 排除回环接口
          if (iface === 'lo') continue
          const fields = line.slice(colonIdx + 1).trim().split(/\s+/)
          rxBytes += parseInt(fields[0] ?? '0', 10)
          txBytes += parseInt(fields[8] ?? '0', 10)
        }
        resolve({ rxBytes, txBytes })
      })
    })
  }

  /** 获取磁盘使用率（系统盘，跨平台） */
  private async getDiskUsage(): Promise<number> {
    return new Promise((resolve) => {
      // 使用 fs.statfs 获取根目录所在分区使用率（Node 18+）
      try {
        const fs = require('fs')
        if (typeof fs.statfs === 'function') {
          const rootPath = process.platform === 'win32' ? 'C:\\' : '/'
          fs.statfs(rootPath, (err: NodeJS.ErrnoException | null, stats: { bsize: number; blocks: number; bfree: number }) => {
            if (err) {
              resolve(0)
              return
            }
            const total = stats.bsize * stats.blocks
            const free = stats.bsize * stats.bfree
            if (total <= 0) {
              resolve(0)
              return
            }
            const usage = ((total - free) / total) * 100
            resolve(Math.round(usage * 100) / 100)
          })
          return
        }
      } catch {
        // ignore
      }
      resolve(0)
    })
  }

  /**
   * 获取进程数（缓存 60s）
   *
   * 跨平台命令：
   * - macOS/Linux: ps aux | wc -l
   * - Windows: tasklist /FI "STATUS eq RUNNING" | wc -l（开销大，降级为 0）
   */
  private async getProcessCount(now: number): Promise<number> {
    // 60 秒内复用缓存
    if (now - this.cachedProcessCountAt < 60_000 && this.cachedProcessCount > 0) {
      return this.cachedProcessCount
    }

    return new Promise((resolve) => {
      const platform = process.platform
      const cmd = platform === 'win32' ? 'tasklist' : 'ps'
      const args = platform === 'win32' ? ['/FI', 'STATUS eq RUNNING'] : ['-e']

      execFile(cmd, args, { maxBuffer: 1 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          // 失败时返回缓存或 0
          resolve(this.cachedProcessCount)
          return
        }
        // 统计行数（减去表头）
        const lines = stdout.split('\n').filter((l) => l.trim().length > 0)
        const count = Math.max(0, lines.length - 1)
        this.cachedProcessCount = count
        this.cachedProcessCountAt = now
        resolve(count)
      })
    })
  }

  /**
   * 获取 CPU 温度（仅 macOS 通过 osx-cpu-temp 或 SMC；其他平台返回 -1）
   *
   * 不依赖外部 npm 包：通过 osascript 调用 macOS 内置工具。
   */
  private async getCpuTemperature(): Promise<number> {
    if (process.platform !== 'darwin') return -1

    return new Promise((resolve) => {
      // 使用 `osascript -e 'do shell script "..."` 包装 SMC 读取（需要权限，失败则返回 -1）
      // 这里使用更稳定的替代方案：读取 powermetrics（需要 sudo，失败则降级）
      execFile('which', ['osx-cpu-temp'], (err) => {
        if (err) {
          resolve(-1)
          return
        }
        execFile('osx-cpu-temp', [], { timeout: 2000 }, (err2, stdout) => {
          if (err2) {
            resolve(-1)
            return
          }
          // 输出格式："61.8°C\n"
          const match = stdout.match(/([\d.]+)\s*°?C?/i)
          if (match) {
            resolve(parseFloat(match[1]))
          } else {
            resolve(-1)
          }
        })
      })
    })
  }

  /**
   * 获取电池信息（跨平台）
   *
   * - macOS: pmset -g batt
   * - Linux: upower（如果安装）
   * - Windows: 未实现（返回 -1）
   */
  private async getBatteryInfo(): Promise<{ percent: number; charging: boolean }> {
    const platform = process.platform

    if (platform === 'darwin') {
      return new Promise((resolve) => {
        execFile('pmset', ['-g', 'batt'], { timeout: 2000 }, (err, stdout) => {
          if (err) {
            resolve({ percent: -1, charging: false })
            return
          }
          // 输出示例："Now drawing from 'Battery Power'\n -InternalBattery-0 (id=12345) 82%; discharging; ..."
          const percentMatch = stdout.match(/(\d+)%/)
          const charging = /AC Power/i.test(stdout)
          resolve({
            percent: percentMatch ? parseInt(percentMatch[1], 10) : -1,
            charging,
          })
        })
      })
    }

    if (platform === 'linux') {
      return new Promise((resolve) => {
        const fs = require('fs')
        fs.readFile('/sys/class/power_supply/BAT0/capacity', 'utf8', (err: NodeJS.ErrnoException | null, data: string) => {
          if (err) {
            resolve({ percent: -1, charging: false })
            return
          }
          const percent = parseInt(data.trim(), 10) || -1
          fs.readFile('/sys/class/power_supply/BAT0/status', 'utf8', (err2: NodeJS.ErrnoException | null, statusData: string) => {
            const charging = err2 ? false : statusData.trim() === 'Charging'
            resolve({ percent, charging })
          })
        })
      })
    }

    return { percent: -1, charging: false }
  }
}
