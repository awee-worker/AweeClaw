/**
 * Git 凭证模块类型定义（主进程 / 渲染进程共享形状）
 *
 * 设计原则：
 * - 凭证按「主机（host）」维度存储：同一 GitHub 账号在多个仓库间复用
 * - 密钥（密码 / Personal Access Token）落盘前由 safeStorage 加密
 * - 对渲染进程只暴露掩码信息（GitCredentialPublic），明文只在主进程内存中短暂存在
 */

/** 凭证协议：只有 http(s) 需要账号密码，ssh 走密钥不在此列 */
export type GitCredentialProtocol = 'https' | 'http' | 'ssh'

/** 落盘记录（仅主进程可见，secret 已加密） */
export interface GitCredentialRecord {
  /** 归一化主机名，如 github.com、gitlab.example.com:8443 */
  host: string
  protocol: GitCredentialProtocol
  username: string
  /** 加密后的密钥（safeStorage；不可用时降级明文并告警） */
  secret: string
  /** 用户是否勾选「记住凭证」 */
  remember: boolean
  createdAt: number
  updatedAt: number
}

/** 暴露给渲染进程的凭证信息（不含明文密钥） */
export interface GitCredentialPublic {
  host: string
  protocol: GitCredentialProtocol
  username: string
  /** 密钥掩码，用于 UI 展示（如 ••••••••） */
  secretMask: string
  remember: boolean
  updatedAt: number
}

/** 保存凭证的入参 */
export interface GitCredentialInput {
  /** 主机名或完整 remote URL（二者皆可，内部会归一化） */
  host: string
  username: string
  /** 密码 / Personal Access Token 明文 */
  secret: string
  /** 是否持久化（false 时仅本次会话内存有效） */
  remember?: boolean
  protocol?: GitCredentialProtocol
}

/** 执行 git 命令时可携带的凭证上下文 */
export interface GitExecCredentialOption {
  /** 目标主机（不传时由主进程从 remote / URL 解析） */
  host?: string
  /** 一次性凭证（来自用户的凭证弹窗），不会落盘 */
  username?: string
  secret?: string
  /** 是否使用已存储凭证（默认 true） */
  useStored?: boolean
}

/** git:execSecure 的可选参数 */
export interface GitExecOptions {
  credential?: GitExecCredentialOption
  /** 命令超时（毫秒），默认 120s。网络命令建议放宽 */
  timeoutMs?: number
  /** 禁止弹窗式交互重试（由调用方自行处理 authRequired） */
  noInteractive?: boolean
}

/** git:execSecure 的统一返回结构 */
export interface GitExecResponse {
  success: boolean
  stdout?: string
  stderr?: string
  exitCode?: number
  error?: string
  /** 需要用户提供凭证（渲染层据此弹出账号密码输入框） */
  authRequired?: boolean
  /** 需要凭证的主机 */
  authHost?: string
  /** 面向用户的提示文案（已本地化前的中性英文 + 关键信息） */
  authHint?: string
}

/** 会话级（未勾选记住）凭证的内存条目 */
export interface GitSessionCredential {
  host: string
  username: string
  secret: string
  protocol: GitCredentialProtocol
}
