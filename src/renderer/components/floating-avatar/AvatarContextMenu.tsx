/**
 * 头像右键菜单组件（菜单窗口渲染内容）
 *
 * 由 avatarEntry.tsx 在 URL 参数 mode=menu 时渲染（AvatarMenuWindow 加载）。
 *
 * 职责：
 * - 挂载后通过 IPC 获取菜单项（主进程实时构建最新状态：显示/隐藏文案、唤醒开关勾选态）
 * - 渲染菜单列表（分隔线 / 普通项 / 勾选项）
 * - 点击项 → IPC 通知主进程分发动作（主进程执行后自动关闭菜单）
 * - ESC → IPC 请求关闭
 * - 点击菜单外区域 → 窗口 blur，主进程自动关闭（无需渲染层处理）
 *
 * 样式规范（与客户端迷你助手窗口一致）：
 * - 宽度固定 168px（与主进程 MENU_WIDTH 一致，定位计算依赖此值，禁止修改）
 * - 淡灰边框 rgba(128,128,128,0.15) + 极淡渐透明阴影
 * - 适配亮/暗主题（prefers-color-scheme）
 */

import { useEffect, useState } from 'react'

/** 菜单项（与主进程 AvatarMenuItem 对齐） */
interface MenuItem {
  id: string
  label: string
  separator?: boolean
  checked?: boolean
}

/** preload 暴露的头像 API（contextBridge） */
const avatarApi = (window as unknown as {
  electronAPI: {
    floatingAvatar: {
      menuGetItems: () => Promise<MenuItem[]>
      menuClick: (itemId: string) => void
      menuClose: () => void
    }
  }
}).electronAPI.floatingAvatar

export function AvatarContextMenu() {
  const [items, setItems] = useState<MenuItem[]>([])

  // 挂载后获取菜单项
  useEffect(() => {
    avatarApi
      .menuGetItems()
      .then((list) => {
        if (Array.isArray(list)) setItems(list)
      })
      .catch((err: unknown) => {
        console.error('[AvatarContextMenu] Get items failed:', err)
      })
  }, [])

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        avatarApi.menuClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleClick = (item: MenuItem) => {
    if (item.separator) return
    avatarApi.menuClick(item.id)
  }

  // hover 高亮：直接设置背景色（不用 CSS 变量间接引用，确保事件到达后立即生效）
  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'var(--avatar-menu-hover)'
  }
  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'transparent'
  }

  return (
    <div style={containerStyle}>
      {items.map((item, index) =>
        item.separator ? (
          <div key={`sep-${index}`} style={separatorStyle} />
        ) : (
          <button
            key={item.id}
            type="button"
            style={itemStyle}
            onClick={() => handleClick(item)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* 勾选标记列（固定宽度，无勾选时占位保持对齐） */}
            <span style={checkStyle}>{item.checked ? '✓' : ''}</span>
            <span style={labelStyle}>{item.label}</span>
          </button>
        ),
      )}
    </div>
  )
}

// ============================================
// 样式
// ============================================

const containerStyle: React.CSSProperties = {
  width: '168px', // 与主进程 MENU_WIDTH 一致，禁止修改（定位计算依赖）
  padding: '6px 0',
  background: 'var(--avatar-menu-bg, rgba(255,255,255,0.98))',
  border: '1px solid rgba(128,128,128,0.15)',
  borderRadius: 10,
  boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
  // 窗口是 transparent，容器自身提供背景；overflow 裁剪圆角
  overflow: 'hidden',
  boxSizing: 'border-box',
  fontFamily: '-apple-system, "PingFang SC", "Segoe UI", sans-serif',
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  height: 32,
  padding: '0 12px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--avatar-menu-fg, #1f2328)',
  textAlign: 'left',
  boxSizing: 'border-box',
  transition: 'background 0.1s ease',
}

const checkStyle: React.CSSProperties = {
  width: 18,
  flexShrink: 0,
  fontSize: 13,
  color: 'var(--avatar-menu-check, #3b82f6)',
}

const labelStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const separatorStyle: React.CSSProperties = {
  height: 1,
  margin: '4px 10px',
  background: 'var(--avatar-menu-separator, rgba(128,128,128,0.2))',
}
