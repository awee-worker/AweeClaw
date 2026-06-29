/**
 * 表单交互卡片组件
 * 用于 ask_form 工具引导用户填写结构化信息
 */

import { useState, useCallback, useMemo } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import {
    ChevronDown,
    CheckCircle2,
    Send,
    Eye,
    EyeOff,
    AlertCircle,
    FileText,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { FormContent, FormField } from '@intelligence/providerTypes'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

interface FormCardProps {
    content: FormContent
    onSubmit: (values: Record<string, string | number | boolean>) => void
    disabled?: boolean
}

function FieldRenderer({
    field,
    value,
    onChange,
    error,
    language,
}: {
    field: FormField
    value: string | number | boolean
    onChange: (val: string | number | boolean) => void
    error?: string
    language: Language
}) {
    const [showPassword, setShowPassword] = useState(false)
    const isInvalid = !!error

    const inputClass = `w-full px-3 py-2 text-xs bg-surface/60 border rounded-lg resize-none focus:outline-none focus:ring-1 transition-all custom-scrollbar placeholder:text-text-muted/60 ${
        isInvalid
            ? 'border-status-error/50 focus:border-status-error/50 focus:ring-status-error/20'
            : 'border-border/50 focus:border-accent/50 focus:ring-accent/20'
    }`

    const labelEl = (
        <label className="text-xs font-medium text-text-secondary flex items-center gap-1">
            {field.label}
            {field.required && <span className="text-status-error">*</span>}
        </label>
    )

    const descEl = field.description && (
        <p className="text-[11px] text-text-muted">{field.description}</p>
    )

    const errorEl = isInvalid && (
        <p className="text-[11px] text-status-error flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {error}
        </p>
    )

    switch (field.type) {
        case 'textarea':
            return (
                <div className="space-y-1.5">
                    {labelEl}
                    <textarea
                        value={String(value)}
                        onChange={e => onChange(e.target.value)}
                        placeholder={field.placeholder}
                        rows={3}
                        className={inputClass}
                    />
                    {descEl}
                    {errorEl}
                </div>
            )

        case 'select':
            return (
                <div className="space-y-1.5">
                    {labelEl}
                    <select
                        value={String(value)}
                        onChange={e => onChange(e.target.value)}
                        className={`${inputClass} appearance-none cursor-pointer`}
                    >
                        <option value="">
                            {field.placeholder || (t('ai.dropdownselector', language as Language))}
                        </option>
                        {field.options?.map(opt => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    {descEl}
                    {errorEl}
                </div>
            )

        case 'radio':
            return (
                <div className="space-y-1.5">
                    {labelEl}
                    <div className="flex flex-wrap gap-2">
                        {field.options?.map(opt => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => onChange(opt.value)}
                                className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                                    String(value) === opt.value
                                        ? 'bg-accent/10 border-accent/30 text-accent'
                                        : 'bg-surface/30 border-border/50 text-text-secondary hover:border-accent/30'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    {descEl}
                    {errorEl}
                </div>
            )

        case 'checkbox':
            return (
                <div className="flex items-center gap-2.5">
                    <button
                        type="button"
                        onClick={() => onChange(!value)}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                            value
                                ? 'bg-accent border-accent'
                                : 'border-border/50 hover:border-accent/50'
                        }`}
                    >
                        {value && (
                            <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        )}
                    </button>
                    <label className="text-xs font-medium text-text-secondary cursor-pointer" onClick={() => onChange(!value)}>
                        {field.label}
                        {field.required && <span className="text-red-400 ml-0.5">*</span>}
                    </label>
                </div>
            )

        case 'number':
            return (
                <div className="space-y-1.5">
                    {labelEl}
                    <input
                        type="number"
                        value={value === '' ? '' : Number(value)}
                        onChange={e => {
                            const v = e.target.value
                            onChange(v === '' ? '' : Number(v))
                        }}
                        placeholder={field.placeholder}
                        min={field.min}
                        max={field.max}
                        className={inputClass}
                    />
                    {descEl}
                    {errorEl}
                </div>
            )

        case 'password':
            return (
                <div className="space-y-1.5">
                    {labelEl}
                    <div className="relative">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={String(value)}
                            onChange={e => onChange(e.target.value)}
                            placeholder={field.placeholder}
                            className={`${inputClass} pr-9`}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                        >
                            {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                    {descEl}
                    {errorEl}
                </div>
            )

        case 'date':
            return (
                <div className="space-y-1.5">
                    {labelEl}
                    <input
                        type="date"
                        value={String(value)}
                        onChange={e => onChange(e.target.value)}
                        className={inputClass}
                    />
                    {descEl}
                    {errorEl}
                </div>
            )

        case 'email':
            return (
                <div className="space-y-1.5">
                    {labelEl}
                    <input
                        type="email"
                        value={String(value)}
                        onChange={e => onChange(e.target.value)}
                        placeholder={field.placeholder || 'email@example.com'}
                        className={inputClass}
                    />
                    {descEl}
                    {errorEl}
                </div>
            )

        default:
            return (
                <div className="space-y-1.5">
                    {labelEl}
                    <input
                        type="text"
                        value={String(value)}
                        onChange={e => onChange(e.target.value)}
                        placeholder={field.placeholder}
                        className={inputClass}
                    />
                    {descEl}
                    {errorEl}
                </div>
            )
    }
}

export function FormCard({ content, onSubmit, disabled }: FormCardProps) {
    const language = useStore(s => s.language)
    const isSubmitted = content.submitted === true

    const initialValues = useMemo(() => {
        const vals: Record<string, string | number | boolean> = {}
        for (const field of content.fields) {
            if (field.defaultValue !== undefined) {
                vals[field.id] = field.defaultValue
            } else if (field.type === 'checkbox') {
                vals[field.id] = false
            } else if (field.type === 'number') {
                vals[field.id] = ''
            } else {
                vals[field.id] = ''
            }
        }
        return vals
    }, [content.fields])

    const [values, setValues] = useState<Record<string, string | number | boolean>>(
        content.values || initialValues
    )
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [submitted, setSubmitted] = useState(isSubmitted)
    const [isExpanded, setIsExpanded] = useState(!isSubmitted)

    const validate = useCallback((): boolean => {
        const newErrors: Record<string, string> = {}

        for (const field of content.fields) {
            const val = values[field.id]

            if (field.required) {
                if (field.type === 'checkbox') {
                    if (val !== true) {
                        newErrors[field.id] = t('ai.thismustbechecked', language as Language)
                    }
                } else if (val === '' || val === undefined || val === null) {
                    newErrors[field.id] = t('ai.thisfieldisrequired', language as Language)
                }
            }

            if (field.type === 'email' && val && typeof val === 'string') {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                if (!emailRegex.test(val)) {
                    newErrors[field.id] = t('ai.pleaseenteravalidemail', language as Language)
                }
            }

            if (field.type === 'number' && val !== '' && val !== undefined) {
                const num = Number(val)
                if (isNaN(num)) {
                    newErrors[field.id] = t('ai.pleaseenteravalidnumber', language as Language)
                } else {
                    if (field.min !== undefined && num < field.min) {
                        newErrors[field.id] = t('ai.minimumvalueis', language as Language, { min: field.min })
                    }
                    if (field.max !== undefined && num > field.max) {
                        newErrors[field.id] = t('ai.maximumvalueis', language as Language, { max: field.max })
                    }
                }
            }

            if (field.pattern && val && typeof val === 'string') {
                try {
                    const regex = new RegExp(field.pattern)
                    if (!regex.test(val)) {
                        newErrors[field.id] = t('ai.invalidformat', language as Language)
                    }
                } catch (e) { logger.ui.warn('Invalid regex pattern:', e) }
            }
        }

        setErrors(newErrors)
        return Object.keys(newErrors).length === 0
    }, [content.fields, values, language])

    const handleSubmit = useCallback(() => {
        if (disabled || submitted) return

        if (!validate()) return

        setSubmitted(true)
        onSubmit(values)
        setIsExpanded(false)
    }, [disabled, submitted, validate, onSubmit, values])

    const handleChange = useCallback((fieldId: string, val: string | number | boolean) => {
        setValues(prev => ({ ...prev, [fieldId]: val }))
        setErrors(prev => {
            const next = { ...prev }
            delete next[fieldId]
            return next
        })
    }, [])

    const filledCount = content.fields.filter(f => {
        const v = values[f.id]
        if (f.type === 'checkbox') return v === true
        return v !== '' && v !== undefined
    }).length

    return (
        <div className={`group my-0.5 relative rounded-lg overflow-hidden transition-colors ${
            submitted
                ? 'hover:bg-text-primary/[0.02]'
                : 'bg-accent/5 border border-accent/15'
        }`}>
            {/* Header */}
            <div
                className="flex items-center gap-2 py-1.5 cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <motion.div
                    animate={{ rotate: isExpanded ? 90 : 0 }}
                    transition={{ duration: 0.15 }}
                    className="shrink-0 text-text-muted/85 hover:text-text-muted"
                >
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                </motion.div>

                <div className="shrink-0 relative z-10 w-4 h-4 flex items-center justify-center">
                    {submitted ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-status-success/10 flex items-center justify-center">
                            <CheckCircle2 className="w-2.5 h-2.5 text-status-success" />
                        </div>
                    ) : (
                        <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
                            <FileText className="w-2 h-2 text-accent" />
                        </div>
                    )}
                </div>

                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden relative z-10">
                    <span className={`text-[12px] ${submitted && !isExpanded ? 'truncate' : ''} ${
                        submitted
                            ? 'text-text-secondary group-hover:text-text-primary transition-colors'
                            : 'text-text-primary font-medium'
                    }`}>
                        {content.title}
                    </span>
                    {!isExpanded && !submitted && (
                        <span className="text-[11px] text-text-muted">
                            ({filledCount}/{content.fields.length})
                        </span>
                    )}
                    {!isExpanded && submitted && content.values && (
                        <span className="text-[11px] text-text-muted/85 truncate">
                            — {Object.entries(content.values)
                                .filter(([, v]) => v !== '' && v !== undefined && v !== false)
                                .map(([k, v]) => {
                                    const field = content.fields.find(f => f.id === k)
                                    return field ? `${field.label}: ${v}` : ''
                                })
                                .filter(Boolean)
                                .slice(0, 3)
                                .join(', ')}
                        </span>
                    )}
                </div>
            </div>

            {/* Expanded Content */}
            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-3 space-y-3">
                            {content.description && (
                                <p className="text-xs text-text-muted">{content.description}</p>
                            )}

                            <div className="space-y-3">
                                {content.fields.map(field => (
                                    <FieldRenderer
                                        key={field.id}
                                        field={field}
                                        value={values[field.id] ?? (field.type === 'checkbox' ? false : '')}
                                        onChange={val => handleChange(field.id, val)}
                                        error={errors[field.id]}
                                        language={language}
                                    />
                                ))}
                            </div>

                            {!submitted && (
                                <div className="flex items-center justify-between pt-2 border-t border-border/30">
                                    <span className="text-[11px] text-text-muted">
                                        {filledCount}/{content.fields.length} {t('ai.filled', language as Language)}
                                    </span>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={disabled}
                                        className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg transition-all ${
                                            disabled
                                                ? 'bg-surface/50 text-text-muted cursor-not-allowed'
                                                : 'bg-accent text-accent-foreground hover:bg-accent-hover active:scale-95'
                                        }`}
                                    >
                                        <Send className="w-3 h-3" />
                                        {content.submitLabel || (t('ai.submit', language as Language))}
                                    </button>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
