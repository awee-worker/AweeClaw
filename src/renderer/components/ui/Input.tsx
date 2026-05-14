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

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className = '', leftIcon, rightIcon, error, success, floatingLabel, helperText, inputSize = 'md', ...props }, ref) => {
        const [isFocused, setIsFocused] = useState(false)
        const [hasValue, setHasValue] = useState(!!props.defaultValue || !!props.value)
        const isFloating = isFocused || hasValue

        const sizeStyles = {
            sm: 'h-8 text-xs',
            md: 'h-10 text-sm',
            lg: 'h-12 text-base',
        }

        const stateBorder = error
            ? 'border-status-error/50 focus:ring-status-error/20 focus:border-status-error'
            : success
                ? 'border-status-success/50 focus:ring-status-success/20 focus:border-status-success'
                : ''

        return (
            <div className="relative flex flex-col w-full">
                <div className="relative flex items-center w-full group">
                    {leftIcon && (
                        <div className="absolute left-3 z-10 text-text-muted pointer-events-none flex items-center justify-center transition-colors group-focus-within:text-accent">
                            {leftIcon}
                        </div>
                    )}
                    {floatingLabel ? (
                        <div className="relative w-full">
                            <input
                                ref={ref}
                                className={`
                                    flex ${sizeStyles[inputSize]} w-full rounded-xl border px-3 py-1 text-text-primary placeholder:text-transparent
                                    shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]
                                    transition-all duration-200 ease-out
                                    bg-surface/50 backdrop-blur-sm border-border
                                    hover:bg-surface hover:border-border-active
                                    focus:outline-none focus:bg-surface/80 focus:border-accent/40 focus:ring-4 focus:ring-accent/10 focus:shadow-[0_0_0_1px_rgba(var(--accent)/0.2)]
                                    disabled:cursor-not-allowed disabled:opacity-50
                                    ${stateBorder}
                                    ${leftIcon ? 'pl-10' : ''}
                                    ${rightIcon ? 'pr-10' : ''}
                                    pt-${isFloating ? '4' : '1'} pb-${isFloating ? '1' : '1'}
                                    ${className}
                                `}
                                onFocus={(e) => { setIsFocused(true); props.onFocus?.(e) }}
                                onBlur={(e) => { setIsFocused(false); if (!e.target.value) setHasValue(false); props.onBlur?.(e) }}
                                onChange={(e) => { setHasValue(!!e.target.value); props.onChange?.(e) }}
                                {...props}
                            />
                            <label className={`
                                absolute left-3 transition-all duration-200 pointer-events-none
                                ${leftIcon ? 'left-10' : 'left-3'}
                                ${isFloating
                                    ? 'top-1 text-[10px] text-accent font-medium'
                                    : 'top-1/2 -translate-y-1/2 text-sm text-text-muted'}
                            `}>
                                {floatingLabel}
                            </label>
                        </div>
                    ) : (
                        <input
                            ref={ref}
                            className={`
                                flex ${sizeStyles[inputSize]} w-full rounded-xl border px-3 py-1 text-text-primary placeholder:text-text-muted/85 
                                shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]
                                transition-all duration-200 ease-out
                                bg-surface/50 backdrop-blur-sm border-border
                                hover:bg-surface hover:border-border-active
                                focus:outline-none focus:bg-surface/80 focus:border-accent/40 focus:ring-4 focus:ring-accent/10 focus:shadow-[0_0_0_1px_rgba(var(--accent)/0.2)]
                                disabled:cursor-not-allowed disabled:opacity-50
                                ${stateBorder}
                                ${leftIcon ? 'pl-10' : ''}
                                ${rightIcon ? 'pr-10' : ''}
                                ${className}
                            `}
                            {...props}
                        />
                    )}
                    {rightIcon && (
                        <div className="absolute right-3 z-10 text-text-muted flex items-center justify-center transition-colors group-focus-within:text-accent">
                            {rightIcon}
                        </div>
                    )}
                </div>
                {helperText && (
                    <span className={`mt-1 text-xs ${error ? 'text-status-error' : success ? 'text-status-success' : 'text-text-muted'}`}>
                        {helperText}
                    </span>
                )}
            </div>
        )
    }
)

Input.displayName = `${BRAND.name}Input`
