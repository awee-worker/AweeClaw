/**
 * 参数校验代码片段集合
 *
 * 提供常见场景工具参数校验样板：
 *  - validate-string:  字符串校验（长度、正则、枚举）
 *  - validate-number:  数字校验（范围、整数、必填）
 *  - validate-array:   数组校验（非空、长度、元素类型）
 *  - validate-object:  对象校验（必填字段、字段类型）
 */
import type { Snippet } from './types'

// 注意：code 字段不含片段变量占位符，可直接作为字面字符串模板使用。

// ==========================================
// 字符串校验
// ==========================================
export const validateStringSnippet: Snippet = {
  id: 'validate-string',
  name: 'Validate String',
  nameZh: '字符串校验',
  description: 'Reusable string validator with length, regex, and enum checks',
  descriptionZh: '通用字符串校验：长度、正则、枚举',
  category: 'validation',
  applicableTypes: ['both'],
  language: 'typescript',
  icon: 'Type',
  tags: ['validation', 'string', 'param'],
  difficulty: 'beginner',
  targetFile: 'src/utils/validators.ts',
  variables: [],
  code: `/**
 * 字符串校验器
 * @param value 原始值
 * @param options 校验选项
 * @returns 校验结果
 */
export function validateString(
  value: unknown,
  options: {
    required?: boolean
    minLength?: number
    maxLength?: number
    pattern?: RegExp
    enumValues?: string[]
    trim?: boolean
  } = {},
): { valid: boolean; value?: string; error?: string } {
  const { required, minLength, maxLength, pattern, enumValues, trim = true } = options

  if (value === undefined || value === null || value === '') {
    if (required) return { valid: false, error: '字段必填' }
    return { valid: true, value: '' }
  }

  let str = String(value)
  if (trim) str = str.trim()
  if (str === '' && required) return { valid: false, error: '字段不能为空' }

  if (minLength !== undefined && str.length < minLength) {
    return { valid: false, error: '长度不能小于 ' + minLength }
  }
  if (maxLength !== undefined && str.length > maxLength) {
    return { valid: false, error: '长度不能超过 ' + maxLength }
  }
  if (pattern && !pattern.test(str)) {
    return { valid: false, error: '格式不正确' }
  }
  if (enumValues && !enumValues.includes(str)) {
    return { valid: false, error: '必须是 [' + enumValues.join(', ') + '] 之一' }
  }
  return { valid: true, value: str }
}`,
  usage: '放置到 src/utils/validators.ts；在执行器中调用：const r = validateString(args.title, { required: true, maxLength: 100 })。',
}

// ==========================================
// 数字校验
// ==========================================
export const validateNumberSnippet: Snippet = {
  id: 'validate-number',
  name: 'Validate Number',
  nameZh: '数字校验',
  description: 'Number validator with range, integer, and required checks',
  descriptionZh: '数字校验：范围、整数、必填',
  category: 'validation',
  applicableTypes: ['both'],
  language: 'typescript',
  icon: 'Hash',
  tags: ['validation', 'number', 'param'],
  difficulty: 'beginner',
  targetFile: 'src/utils/validators.ts',
  variables: [],
  code: `/**
 * 数字校验器
 * @param value 原始值
 * @param options 校验选项
 * @returns 校验结果
 */
export function validateNumber(
  value: unknown,
  options: {
    required?: boolean
    min?: number
    max?: number
    integer?: boolean
    default?: number
  } = {},
): { valid: boolean; value?: number; error?: string } {
  const { required, min, max, integer, default: defaultValue } = options

  if (value === undefined || value === null || value === '') {
    if (required) return { valid: false, error: '字段必填' }
    return { valid: true, value: defaultValue }
  }

  const num = Number(value)
  if (!Number.isFinite(num)) {
    return { valid: false, error: '必须是有效数字' }
  }
  if (integer && !Number.isInteger(num)) {
    return { valid: false, error: '必须是整数' }
  }
  if (min !== undefined && num < min) {
    return { valid: false, error: '不能小于 ' + min }
  }
  if (max !== undefined && num > max) {
    return { valid: false, error: '不能大于 ' + max }
  }
  return { valid: true, value: num }
}`,
  usage: '与 validateString 同一文件；执行器内：const r = validateNumber(args.limit, { min: 1, max: 100, default: 10 })。',
}

// ==========================================
// 数组校验
// ==========================================
export const validateArraySnippet: Snippet = {
  id: 'validate-array',
  name: 'Validate Array',
  nameZh: '数组校验',
  description: 'Array validator with type, length, and element checks',
  descriptionZh: '数组校验：类型、长度、元素校验',
  category: 'validation',
  applicableTypes: ['both'],
  language: 'typescript',
  icon: 'List',
  tags: ['validation', 'array', 'param'],
  difficulty: 'intermediate',
  targetFile: 'src/utils/validators.ts',
  variables: [],
  code: `/**
 * 数组校验器
 * @param value 原始值
 * @param options 校验选项（itemValidator 可对每个元素校验）
 * @returns 校验结果
 */
export function validateArray<T = unknown>(
  value: unknown,
  options: {
    required?: boolean
    minLength?: number
    maxLength?: number
    itemValidator?: (item: unknown, index: number) => { valid: boolean; value?: T; error?: string }
  } = {},
): { valid: boolean; value?: T[]; error?: string } {
  const { required, minLength, maxLength, itemValidator } = options

  if (!Array.isArray(value)) {
    if (required) return { valid: false, error: '必须是数组' }
    return { valid: true, value: [] }
  }
  if (required && value.length === 0) {
    return { valid: false, error: '数组不能为空' }
  }
  if (minLength !== undefined && value.length < minLength) {
    return { valid: false, error: '数组长度不能小于 ' + minLength }
  }
  if (maxLength !== undefined && value.length > maxLength) {
    return { valid: false, error: '数组长度不能超过 ' + maxLength }
  }
  if (itemValidator) {
    const results: T[] = []
    for (let i = 0; i < value.length; i++) {
      const r = itemValidator(value[i], i)
      if (!r.valid) return { valid: false, error: '第 ' + (i + 1) + ' 项：' + r.error }
      if (r.value !== undefined) results.push(r.value)
    }
    return { valid: true, value: results }
  }
  return { valid: true, value: value as T[] }
}`,
  usage: '常用于批量操作工具的 ids 参数校验：validateArray(args.ids, { required: true, minLength: 1, itemValidator: v => validateString(v, { required: true }) })。',
}

// ==========================================
// 对象校验（轻量级 schema）
// ==========================================
export const validateObjectSnippet: Snippet = {
  id: 'validate-object',
  name: 'Validate Object',
  nameZh: '对象校验',
  description: 'Lightweight object schema validator with required fields and type checks',
  descriptionZh: '轻量级对象 schema 校验：必填字段、字段类型',
  category: 'validation',
  applicableTypes: ['both'],
  language: 'typescript',
  icon: 'Box',
  tags: ['validation', 'object', 'schema'],
  difficulty: 'advanced',
  targetFile: 'src/utils/validators.ts',
  variables: [],
  code: `/**
 * 对象 schema 校验器
 * @param value 原始值
 * @param schema 字段定义
 * @returns 校验结果（包含规范化后的对象）
 */
export interface ObjectSchemaField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required?: boolean
  validator?: (value: unknown) => { valid: boolean; value?: unknown; error?: string }
}

export function validateObject(
  value: unknown,
  schema: ObjectSchemaField[],
): { valid: boolean; value?: Record<string, unknown>; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, error: '必须是对象' }
  }
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const field of schema) {
    const raw = obj[field.name]
    if (raw === undefined || raw === null) {
      if (field.required) return { valid: false, error: '字段 ' + field.name + ' 必填' }
      continue
    }
    // 类型检查
    const actualType = Array.isArray(raw) ? 'array' : typeof raw
    if (actualType !== field.type) {
      return { valid: false, error: '字段 ' + field.name + ' 必须是 ' + field.type + ' 类型' }
    }
    // 自定义校验
    if (field.validator) {
      const r = field.validator(raw)
      if (!r.valid) {
        return { valid: false, error: '字段 ' + field.name + '：' + r.error }
      }
      out[field.name] = r.value
    } else {
      out[field.name] = raw
    }
  }
  return { valid: true, value: out }
}`,
  usage: '在执行器入口校验复杂参数：validateObject(args, [{ name: "title", type: "string", required: true, validator: v => validateString(v, { maxLength: 100 }) }])。',
}
