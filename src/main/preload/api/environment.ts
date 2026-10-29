/**
 * 运行时环境管理 API
 *
 * 覆盖 IPC 频道：
 * - environment:check      — 检测 Python/uv/Node 状态（只读）
 * - environment:install    — 安装指定运行时
 * - environment:installAll — 一键安装所有缺失项
 * - environment:progress  — 安装进度事件订阅
 */
import { invoke, on } from '../ipcHelpers'

export function createEnvironmentApi() {
  return {
    // ── 环境检测与安装 ──
    /** 检测全部核心运行时状态（只读，秒级返回，不触发安装） */
    environmentCheck: invoke<{ success: boolean; status: import('../../modules/runtime/EnvironmentSetupService').EnvironmentStatus }>('environment:check'),

    /** 安装指定运行时（推送进度事件） */
    environmentInstall: (id: 'python' | 'uv' | 'node') =>
      invoke<{ success: boolean }>('environment:install')(id),

    /** 一键安装所有缺失项（按 uv→python→node 顺序串行） */
    environmentInstallAll: invoke<{ success: boolean; status: import('../../modules/runtime/EnvironmentSetupService').EnvironmentStatus }>('environment:installAll'),

    /**
     * 探测命令是否安装（只读，按 PATH 遍历文件系统，不经终端）
     *
     * ffmpeg / ffprobe 这类本地依赖用它判断，比下发 run_command 快两个数量级，
     * 也不会因为用户 shell 配置阻塞而超时。
     */
    environmentProbeBinary: (
      command: string,
      options?: {
        withVersion?: boolean
        versionArgs?: string[]
        versionTimeoutMs?: number
        force?: boolean
      },
    ) =>
      invoke<{
        success: boolean
        result: {
          found: boolean
          command: string
          path: string | null
          version: string | null
          versionError?: string
          source: 'absolute' | 'common' | 'path' | 'shell' | 'none'
          searchedDirs: number
          elapsedMs: number
        } | null
        error?: string
      }>('environment:probeBinary')(command, options),

    /** 订阅安装进度事件（取消安装弹窗时调用返回的取消函数） */
    onEnvironmentProgress: on<import('../../modules/runtime/EnvironmentSetupService').InstallProgressEvent>('environment:progress'),
  }
}
