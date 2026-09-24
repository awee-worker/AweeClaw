/**
 * 后端依赖面板的登录引导
 *
 * 项目 / 任务 / 自动化 / 插件市场等面板的数据来自云端后端：
 * 未登录时 serverUrl 为空，请求会直接抛错，用户看到的只有一句"加载失败"，
 * 无法判断是网络问题、服务故障还是自己没登录。
 *
 * 这类面板在未登录时应统一渲染本组件，给出明确的登录入口，
 * 登录动作通过 `aweeclaw:open-login` 事件交给 NavigationRail 的登录弹窗，
 * 避免每个面板各自维护一份登录 UI 与认证状态。
 */

import { LogIn } from 'lucide-react'
import { useStore } from '@store'

export function BackendLoginRequired({
  isZh,
  /** 面板名称，用于提示文案，如「项目」「自动化」 */
  scope,
}: {
  isZh: boolean
  scope?: string
}) {
  const setShowUserProfilePage = useStore((s) => s.setShowUserProfilePage)

  const title = isZh ? '登录后即可使用' : 'Sign in to continue'
  const description = scope
    ? (isZh
      ? `${scope}的数据保存在 AweeClaw 云端，登录后即可查看与管理。`
      : `${scope} data lives in AweeClaw Cloud. Sign in to view and manage it.`)
    : (isZh
      ? '该功能的数据保存在 AweeClaw 云端，登录后即可查看与管理。'
      : 'This feature stores data in AweeClaw Cloud. Sign in to view and manage it.')

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-3">
        <LogIn className="w-5 h-5 text-accent" strokeWidth={1.5} />
      </div>
      <p className="text-[14px] font-medium text-text-primary">{title}</p>
      <p className="mt-1.5 max-w-[360px] text-[12.5px] leading-relaxed text-text-muted">{description}</p>
      <div className="mt-5 flex items-center gap-2">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('aweeclaw:open-login'))}
          className="h-8 px-4 rounded-lg bg-accent text-white text-[13px] font-medium hover:bg-accent/90 transition-colors"
        >
          {isZh ? '立即登录' : 'Sign in'}
        </button>
        <button
          onClick={() => setShowUserProfilePage(true)}
          className="h-8 px-4 rounded-lg border border-border/60 text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          {isZh ? '账号管理' : 'Account'}
        </button>
      </div>
    </div>
  )
}

export default BackendLoginRequired
