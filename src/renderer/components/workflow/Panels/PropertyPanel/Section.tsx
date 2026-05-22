import { useState } from 'react'

interface SectionProps {
  title: string
  children: React.ReactNode
  tip?: string
  collapsible?: boolean
}

export function Section({ title, children, tip, collapsible }: SectionProps) {
  const [collapsed, setCollapsed] = useState(collapsible ?? false)

  return (
    <div className="space-y-1.5">
      <div
        className={`flex items-center gap-1 ${collapsible ? 'cursor-pointer select-none' : ''}`}
        onClick={collapsible ? () => setCollapsed(!collapsed) : undefined}
      >
        <label className="block text-[10px] font-semibold text-gray-450 uppercase tracking-wider flex-shrink-0">
          {title}
        </label>
        {tip && !collapsed && (
          <span className="text-[9px] text-gray-350 truncate" title={tip}>
            ({tip})
          </span>
        )}
        {collapsible && (
          <svg
            className={`w-3 h-3 ml-auto text-gray-350 transition-transform ${collapsed ? '' : 'rotate-90'}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="9,18 15,12 9,6" />
          </svg>
        )}
      </div>
      {!collapsed && children}
    </div>
  )
}

export function SectionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-gray-500 flex-shrink-0">{label}</span>
      <div className="flex-1 max-w-[160px]">{children}</div>
    </div>
  )
}

export function HelpTip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 text-[10px] leading-relaxed text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
      💡 {children}
    </div>
  )
}