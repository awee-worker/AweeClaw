/**
 * 表单交互类型定义（用于 ask_form 工具）
 */

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'number'
  | 'email'
  | 'date'
  | 'checkbox'
  | 'radio'
  | 'password'

export interface FormFieldOption {
  label: string
  value: string
}

export interface FormField {
  id: string
  type: FormFieldType
  label: string
  placeholder?: string
  required?: boolean
  defaultValue?: string | number | boolean
  options?: FormFieldOption[]
  min?: number
  max?: number
  pattern?: string
  description?: string
}

export interface FormContent {
  type: 'form'
  title: string
  description?: string
  fields: FormField[]
  submitLabel?: string
  submitted?: boolean
  values?: Record<string, string | number | boolean>
}
