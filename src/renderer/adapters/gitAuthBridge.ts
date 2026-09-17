/**
 * Git 凭证请求桥（渲染进程）
 *
 * 职责：解耦「需要凭证的 git 操作」与「UI 弹窗」——
 * gitAdapter / AI 工具在浏览器（非 React）上下文执行，不能直接渲染组件；
 * UI 层在挂载时注册 handler，二者通过本模块通信。
 *
 * 使用方式：
 *   // UI 层（GitAuthPromptOverlay 挂载时）
 *   setGitCredentialPromptHandler((request) => globalGitAuth(request))
 *
 *   // 业务层
 *   const answer = await requestGitCredential({ host: 'github.com', ... })
 *   if (!answer) return   // 用户取消 / 超时
 *
 * @module adapters/gitAuthBridge
 */

/** 凭证请求上下文 */
export interface GitCredentialRequest {
  /** 目标主机（可能为空：remote 未配置或无法解析时） */
  host: string
  /** 提示类型：普通账号密码 / 平台已禁用密码认证（必须用 Token） */
  hint: 'credential-required' | 'token-required'
  /** 触发此次凭证请求的操作描述（如 "git push"），用于弹窗文案 */
  operation: string
  /** 该主机上是否已有（失效的）已存凭证 */
  hasStoredCredential?: boolean
}

/** 用户填写结果 */
export interface GitCredentialAnswer {
  username: string
  secret: string
  /** 是否持久化保存（勾选「记住」） */
  remember: boolean
}

type GitCredentialPromptHandler = (request: GitCredentialRequest) => Promise<GitCredentialAnswer | null>

let promptHandler: GitCredentialPromptHandler | null = null

/** 由 UI 层注册（卸载时传 null） */
export function setGitCredentialPromptHandler(handler: GitCredentialPromptHandler | null): void {
  promptHandler = handler
}

export function hasGitCredentialPromptHandler(): boolean {
  return promptHandler !== null
}

/**
 * 向用户索要凭证
 *
 * @returns 用户填写的凭证；用户取消、弹窗不可用或超时返回 null
 */
export async function requestGitCredential(
  request: GitCredentialRequest,
): Promise<GitCredentialAnswer | null> {
  if (!promptHandler) return null
  try {
    return await promptHandler(request)
  } catch {
    return null
  }
}
