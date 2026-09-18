/**
 * 工具路径放行策略
 *
 * 工具执行前的路径校验（toolExecutors.resolvePath）必须与主进程
 * SecurityManager.validateWorkspacePath 使用同一套放行依据，否则会出现
 * 「在 设置 → 安全设置 里加了工作区外允许访问的目录，AI 仍报
 *  Path is outside workspace」这类设置不生效的问题。
 *
 * 放行来源（顺序与主进程一致）：
 * 1. 项目执行窗口的项目目录（可能不在工作区内，写入 store.allowedToolPaths）
 * 2. 用户配置的「工作区外允许访问的目录」（store.securitySettings.allowedExternalDirectories）
 * 3. 可信应用数据目录（插件 / 场景 / 技能 / 运行时所在的应用配置存储目录），
 *    读写均放行，对应主进程 SecurityManager.addAllowedAppPath，两边必须一致
 * 4. 关闭「严格工作区模式」时，不再限制工作区边界
 * 5. 只读可信目录：**仅读取操作**放行，写入仍受边界约束
 *    （对应主进程 SecurityManager.isTrustedReadOnlyPath，两边必须一致）
 *
 * 注意：敏感路径（.ssh / .aws 等）由 validatePath 内部始终拦截，
 * 不因这里的放行而放开。
 */

import type { SecurityPolicyPanel } from '@shared/configuration/configTypes'

/** 策略来源（均取自渲染层 store） */
export interface ToolPathPolicySources {
    /** 项目执行窗口写入的额外允许目录 */
    allowedToolPaths?: string[] | null
    /** 用户配置的安全设置 */
    securitySettings?: Pick<
        SecurityPolicyPanel,
        'allowedExternalDirectories' | 'strictWorkspaceMode'
    > | null
    /**
     * 可信应用数据目录（插件 / 场景 / 技能 / 运行时所在的应用配置存储目录）
     * 读写均放行，与主进程 SecurityManager.addAllowedAppPath 保持一致
     */
    trustedAppDataRoots?: string[] | null
    /**
     * 只读可信目录
     * 仅在读取操作时并入放行列表，写入操作不放行
     */
    trustedReadOnlyRoots?: string[] | null
}

/** 路径校验策略 */
export interface ToolPathPolicy {
    /** 除工作区外额外允许访问的根目录（读写均放行） */
    extraAllowedRoots: string[]
    /** 仅读取操作放行的额外根目录（写入不放行） */
    extraReadOnlyRoots: string[]
    /** 是否跳过工作区边界检查 */
    allowOutsideWorkspace: boolean
}

/**
 * 由设置来源推导出路径校验策略
 *
 * 纯函数，便于单测覆盖「用户配置的工作区外目录被正确纳入放行列表」。
 */
export function buildToolPathPolicy(sources: ToolPathPolicySources): ToolPathPolicy {
    const extraAllowedRoots = [
        ...(sources.allowedToolPaths ?? []),
        ...(sources.securitySettings?.allowedExternalDirectories ?? []),
        ...(sources.trustedAppDataRoots ?? []),
    ].filter((dir): dir is string => typeof dir === 'string' && dir.length > 0)

    const extraReadOnlyRoots = (sources.trustedReadOnlyRoots ?? []).filter(
        (dir): dir is string => typeof dir === 'string' && dir.length > 0
    )

    return {
        extraAllowedRoots,
        extraReadOnlyRoots,
        allowOutsideWorkspace: sources.securitySettings?.strictWorkspaceMode === false,
    }
}
