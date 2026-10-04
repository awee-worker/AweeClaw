/**
 * 邮件中心窗口 - 渲染进程入口
 *
 * 极简启动：仅加载 MailCenterApp 组件。
 * 不加载主窗口的 Store / Router / Monaco 等重依赖，
 * 作为轻量独立 renderer（与 meetingNotesEntry 同模式），
 * 通过 preload API 与主进程通信。
 *
 * 引入 globals.css 以使用 Tailwind 工具类与主题色 CSS 变量。
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { MailCenterApp } from './components/mail-center/MailCenterApp'
import './styles/globals.css'

// 注入生产环境标记（供 shared 代码使用）
globalThis.__PROD__ = import.meta.env.PROD

const rootEl = document.getElementById('root')
if (!rootEl) {
  console.error('[MailCenterEntry] Root element #root not found')
} else {
  const root = ReactDOM.createRoot(rootEl)
  root.render(
    <React.StrictMode>
      <MailCenterApp />
    </React.StrictMode>,
  )
}
