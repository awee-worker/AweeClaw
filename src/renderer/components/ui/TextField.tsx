import React, { InputHTMLAttributes, forwardRef, useState } from 'react'
import { BRAND } from '@shared/brand'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  error?: boolean
  success?: boolean
  floatingLabel?: string
  helperText?: string
  inputSize?: 'sm' | 'md' | 'lg'
}

const DIM_MAP: Record<string, string> = { sm: 'h-8 text-xs', md: 'h-10 text-sm', lg: 'h-12 text-base' }

function borderState(error?: boolean, success?: boolean): string {
  if (error) return 'border-status-error/50 focus:ring-status-error/20 focus:border-status-error'
  if (success) return 'border-status-success/50 focus:ring-status-success/20 focus:border-status-success'
  return ''
}

const BASE_INPUT = 'flex w-full rounded-xl border px-3 py-1 text-text-primary shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] transition-all duration-200 ease-out bg-surface/50 backdrop-blur-sm border-border hover:bg-surface hover:border-border-active focus:outline-none focus:bg-surface/80 focus:border-accent/40 focus:ring-4 focus:ring-accent/10 focus:shadow-[0_0_0_1px_rgba(var(--accent)/0.2)] disabled:cursor-not-allowed disabled:opacity-50'

export const TextField = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', leftIcon, rightIcon, error, success, floatingLabel, helperText, inputSize = 'md', ...rest }, ref) => {
    const [focused, setFocused] = useState(false)
    const [filled, setFilled] = useState(!!rest.defaultValue || !!rest.value)
    const elevated = focused || filled

    const stateBorder = borderState(error, success)
    const padLeft = leftIcon ? 'pl-10' : ''
    const padRight = rightIcon ? 'pr-10' : ''

    return (
      <div className="relative flex flex-col w-full">
        <div className="relative flex items-center w-full group">
          {leftIcon && (
            <div className="absolute left-3 z-10 text-text-muted pointer-events-none flex items-center justify-center transition-colors group-focus-within:text-accent">{leftIcon}</div>
          )}
          {floatingLabel ? (
            <div className="relative w-full">
              <input
                ref={ref}
                className={`${BASE_INPUT} ${DIM_MAP[inputSize]} placeholder:text-transparent ${stateBorder} ${padLeft} ${padRight} ${elevated ? 'pt-4 pb-1' : 'pt-1 pb-1'} ${className}`}
                onFocus={e => { setFocused(true); rest.onFocus?.(e) }}
                onBlur={e => { setFocused(false); if (!e.target.value) setFilled(false); rest.onBlur?.(e) }}
                onChange={e => { setFilled(!!e.target.value); rest.onChange?.(e) }}
                {...rest}
              />
              <label className={`absolute transition-all duration-200 pointer-events-none ${leftIcon ? 'left-10' : 'left-3'} ${elevated ? 'top-1 text-[10px] text-accent font-medium' : 'top-1/2 -translate-y-1/2 text-sm text-text-muted'}`}>{floatingLabel}</label>
            </div>
          ) : (
            <input
              ref={ref}
              className={`${BASE_INPUT} ${DIM_MAP[inputSize]} placeholder:text-text-muted/85 ${stateBorder} ${padLeft} ${padRight} ${className}`}
              {...rest}
            />
          )}
          {rightIcon && (
            <div className="absolute right-3 z-10 text-text-muted flex items-center justify-center transition-colors group-focus-within:text-accent">{rightIcon}</div>
          )}
        </div>
        {helperText && (
          <span className={`mt-1 text-xs ${error ? 'text-status-error' : success ? 'text-status-success' : 'text-text-muted'}`}>{helperText}</span>
        )}
      </div>
    )
  },
)

TextField.displayName = `${BRAND.name}TextField`
