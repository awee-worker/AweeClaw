/**
 * Go 环境管理 API
 *
 * 覆盖 IPC 频道：
 * - go:getStatus     — Go 运行时状态
 * - go:getPath       — go 可执行文件路径
 * - go:getGofmtPath  — gofmt 可执行文件路径
 * - go:getRoot       — GOROOT 根目录
 * - go:ensureReady   — 检测并按需安装
 * - go:redetect      — 重新探测本机 Go（不安装）
 * - go:reinstall     — 重新安装
 * - go:setCustomPath — 指定 go 路径
 */
import { invoke } from '../ipcHelpers'

export function createGoApi() {
  return {
    goGetStatus: invoke('go:getStatus'),
    goRedetect: invoke('go:redetect'),
    goGetPath: invoke('go:getPath'),
    goGetGofmtPath: invoke('go:getGofmtPath'),
    goGetRoot: invoke('go:getRoot'),
    goEnsureReady: invoke('go:ensureReady'),
    goReinstall: invoke('go:reinstall'),
    goSetCustomPath: (customPath: string | null) => invoke('go:setCustomPath')(customPath),
  }
}
