/**
 * Tree-sitter 语言查询配置
 *
 * 集中管理文件扩展名到语言名的映射与各语言的语法查询语句
 */

/** 文件扩展名 → Tree-sitter 语言名 */
export const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, string>> = Object.freeze({
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyw: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  cs: 'c_sharp',
  rb: 'ruby',
  php: 'php',
  json: 'json',
})

/** 捕获名称 → 代码块类型映射 */
const CAPTURE_TYPE_MAP: Readonly<Record<string, 'function' | 'class' | 'block'>> = Object.freeze({
  function: 'function',
  method: 'function',
  arrow_function: 'function',
  constructor: 'function',
  class: 'class',
  interface: 'class',
  struct: 'class',
  enum: 'class',
  trait: 'class',
  impl: 'class',
  module: 'class',
  type: 'block',
  statement: 'block',
} as Record<string, 'function' | 'class' | 'block'>)

/** 根据捕获名称获取代码块类型 */
export function resolveChunkType(captureName: string): 'function' | 'class' | 'block' {
  return CAPTURE_TYPE_MAP[captureName] ?? 'block'
}

/** 各语言的语法查询语句 */
export const LANGUAGE_QUERIES: Readonly<Record<string, string>> = Object.freeze({
  typescript: [
    '(function_declaration) @function',
    '(generator_function_declaration) @function',
    '(class_declaration) @class',
    '(interface_declaration) @interface',
    '(type_alias_declaration) @type',
    '(method_definition) @method',
    '(export_statement (function_declaration)) @function',
    '(export_statement (class_declaration)) @class',
    '(variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)] @function_body) @arrow_function',
    '(program (expression_statement)) @statement',
    '(program (lexical_declaration)) @statement',
  ].join('\n'),

  tsx: [
    '(function_declaration) @function',
    '(class_declaration) @class',
    '(interface_declaration) @interface',
    '(type_alias_declaration) @type',
    '(method_definition) @method',
    '(variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)] @function_body) @arrow_function',
  ].join('\n'),

  javascript: [
    '(function_declaration) @function',
    '(generator_function_declaration) @function',
    '(class_declaration) @class',
    '(method_definition) @method',
    '(variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)] @function_body) @arrow_function',
  ].join('\n'),

  python: [
    '(function_definition) @function',
    '(class_definition) @class',
    '(module (expression_statement)) @statement',
  ].join('\n'),

  go: [
    '(function_declaration) @function',
    '(method_declaration) @method',
    '(type_declaration) @type',
  ].join('\n'),

  rust: [
    '(function_item) @function',
    '(struct_item) @struct',
    '(enum_item) @enum',
    '(impl_item) @impl',
    '(trait_item) @trait',
  ].join('\n'),

  java: [
    '(class_declaration) @class',
    '(interface_declaration) @interface',
    '(enum_declaration) @enum',
    '(method_declaration) @method',
    '(constructor_declaration) @constructor',
  ].join('\n'),

  cpp: [
    '(function_definition) @function',
    '(class_specifier) @class',
    '(struct_specifier) @struct',
  ].join('\n'),

  c: [
    '(function_definition) @function',
    '(struct_specifier) @struct',
  ].join('\n'),

  c_sharp: [
    '(class_declaration) @class',
    '(interface_declaration) @interface',
    '(enum_declaration) @enum',
    '(struct_declaration) @struct',
    '(method_declaration) @method',
    '(constructor_declaration) @constructor',
  ].join('\n'),

  ruby: [
    '(method) @function',
    '(class) @class',
    '(module) @module',
  ].join('\n'),

  php: [
    '(function_definition) @function',
    '(class_declaration) @class',
    '(interface_declaration) @interface',
    '(trait_declaration) @trait',
    '(method_declaration) @method',
  ].join('\n'),
})

/** 根据文件扩展名获取 Tree-sitter 语言名 */
export function getLanguageByExtension(ext: string): string | undefined {
  return EXTENSION_LANGUAGE_MAP[ext.toLowerCase()]
}

/** 获取指定语言的查询语句 */
export function getQueryForLanguage(langName: string): string | undefined {
  return LANGUAGE_QUERIES[langName]
}
