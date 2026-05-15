import React, { forwardRef } from 'react'
import { BRAND } from '@shared/brand'

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  switchSize?: 'sm' | 'md' | 'lg'
  statusText?: { on: string; off: string }
}

type SizeCfg = { track: string; thumb: string; shift: string; font: string }

const SIZE_CFG: Record<string, SizeCfg> = {
  sm: { track: 'w-8 h-4', thumb: 'w-3 h-3', shift: 'translate-x-4', font: 'text-[9px]' },
  md: { track: 'w-11 h-6', thumb: 'w-5 h-5', shift: 'translate-x-5', font: 'text-xs' },
  lg: { track: 'w-14 h-7', thumb: 'w-6 h-6', shift: 'translate-x-7', font: 'text-sm' },
}

export const ToggleSwitch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className = '', label, switchSize = 'md', statusText, ...rest }, ref) => {
    const cfg = SIZE_CFG[switchSize]

    return (
      <label className={`inline-flex items-center cursor-pointer group select-none ${className}`}>
        <div className="relative">
          <input type="checkbox" className="sr-only peer" ref={ref} {...rest} />
          <div className={`${cfg.track} rounded-full bg-surface-active/50 border border-border backdrop-blur-sm peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent/50 peer-checked:bg-accent peer-checked:border-accent transition-all duration-300 ease-in-out group-hover:border-accent/30`} />
          <div className={`absolute top-0.5 left-0.5 bg-white ${cfg.thumb} rounded-full shadow-md transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] peer-checked:${cfg.shift} group-hover:scale-95 peer-checked:group-hover:scale-110`}>
            <div className="absolute inset-0 rounded-full bg-accent/0 peer-checked:bg-accent/10 transition-colors" />
          </div>
          {statusText && (
            <span className={`absolute inset-0 flex items-center justify-center ${cfg.font} font-medium pointer-events-none transition-all duration-300 peer-checked:text-white text-text-muted/60`}>
              <span className="peer-checked:opacity-100 opacity-0 transition-opacity">{statusText.on}</span>
              <span className="peer-checked:opacity-0 opacity-100 transition-opacity absolute">{statusText.off}</span>
            </span>
          )}
        </div>
        {label && <span className="ml-3 text-sm font-medium text-text-muted group-hover:text-text-primary transition-colors duration-200">{label}</span>}
      </label>
    )
  },
)

ToggleSwitch.displayName = `${BRAND.name}ToggleSwitch`
