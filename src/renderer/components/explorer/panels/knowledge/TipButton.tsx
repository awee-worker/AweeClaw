export function TipButton({
  onClick,
  disabled,
  active,
  tip,
  className = '',
  children,
}: {
  onClick: React.MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  active?: boolean
  tip: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group/tip relative transition-colors disabled:opacity-40 ${
        active ? 'text-accent' : 'text-text-muted hover:text-accent'
      } ${className}`}
    >
      {children}
      <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 rounded-md bg-gray-900 text-white text-[12px] whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 shadow-lg">
        {tip}
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 -mb-px border-4 border-transparent border-b-gray-900" />
      </span>
    </button>
  )
}
