/**
 * 侧边面板图标
 *
 * filled 表示面板处于展开态（左侧区块填充），未填充表示收起态。
 * 顶部标题栏的切换按钮与导航栏内的收起按钮共用，保证两处视觉一致。
 */
export function PanelLeftIcon({ filled = false, className }: { filled?: boolean; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      {filled && <path d="M3 5a2 2 0 0 1 2-2h4v18H5a2 2 0 0 1-2-2V5z" fill="currentColor" opacity="0.75" stroke="none" />}
      <line x1="9" x2="9" y1="3" y2="21" />
    </svg>
  )
}

export default PanelLeftIcon
