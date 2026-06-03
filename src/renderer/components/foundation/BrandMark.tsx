import { useStore } from '@store'
import { publicAsset } from '@utils/publicAsset'
import { BRAND } from '@shared/brand'

export function Logo({ className = "w-6 h-6", glow = false }: { className?: string; glow?: boolean }) {
  const currentTheme = useStore(s => s.currentTheme)
  const isLight = currentTheme.endsWith('-light')

  return (
    <img
      src={publicAsset(isLight ? 'brand/logos/app-light.png' : 'brand/logos/app.png')}
      alt={BRAND.name}
      className={`${className} ${glow ? 'drop-shadow-[0_0_8px_rgba(var(--accent),0.6)]' : ''}`}
    />
  )
}
