/**
 * 工具包完整性守卫测试
 *
 * 防止两类回归事故：
 *  1) 场景声明了**未注册**的工具包 id
 *     → resolveDependencies() 会静默跳过，导致「声明了工具包却拿不到对应工具」
 *     （历史事故：scenario-builder 声明了不存在的 'filesystem'）
 *  2) 工具包声明了**没有内置执行器**的工具
 *     → 工具名会进入 LLM 工具列表与系统提示词，调用时落到 `Unknown tool` 失败
 *     （历史事故：data / web / media / office 包的 17 个工具无执行器）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { toolPackRegistry } from '@configuration/toolPacks'
import { getToolsForContext } from '@configuration/toolCategoryDefs'
import { TOOL_DEFINITIONS } from '@configuration/toolDefinitions'
import { BUILTIN_TOOL_OPTIONS } from '../../../src/scenarios/scenario-builder/config/scenarioOptionCatalog'

const ROOT = path.resolve(__dirname, '../../..')
const SRC = path.join(ROOT, 'src')

/**
 * 工具由场景项目自身通过 toolRegistry.registerScenarioTool() 注册的工具包，
 * 编译期无法静态枚举其执行器，因此不纳入「必须有内置执行器」的断言范围。
 */
const SCENARIO_PROVIDED_PACKS = new Set(['education', 'store-diagnosis'])

/** 系统无条件注入、不属于任何工具包的工具（见 getToolsForContext） */
const SYSTEM_INJECTED_TOOLS = new Set(['extract_document'])

/** 已在 CORE_TOOLS 中保留、但无工具定义亦无执行器的历史遗留名 */
const LEGACY_TOOL_NAMES = new Set(['get_dir_tree', 'read_multiple_files', 'replace_file_content'])

/** 从 toolExecutors.ts 静态提取 `name(args, ...)` 形式的执行器名 */
function extractBuiltinExecutorNames(): Set<string> {
  const file = path.join(SRC, 'renderer/intelligence/toolkit/toolExecutors.ts')
  const src = fs.readFileSync(file, 'utf8')
  const names = [...src.matchAll(/^ {4}(?:async )?([A-Za-z_][A-Za-z0-9_]*)\(args/gm)].map(m => m[1])
  return new Set(names)
}

/** 递归扫描 src，收集所有 `toolPacks: [...]` 字面量声明 */
function collectDeclaredToolPacks(): Array<{ file: string; packs: string[] }> {
  const result: Array<{ file: string; packs: string[] }> = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (/\.tsx?$/.test(entry.name)) {
        const src = fs.readFileSync(full, 'utf8')
        for (const m of src.matchAll(/toolPacks:\s*\[([^\]]*)\]/g)) {
          const packs = [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map(x => x[1] ?? x[2])
          if (packs.length > 0) {
            result.push({ file: path.relative(ROOT, full), packs })
          }
        }
      }
    }
  }
  walk(SRC)
  return result
}

describe('ToolPack 完整性', () => {
  it('每个工具包声明的 tools 都必须有内置执行器', () => {
    const executors = extractBuiltinExecutorNames()
    const violations: string[] = []

    for (const pack of toolPackRegistry.getAll()) {
      if (SCENARIO_PROVIDED_PACKS.has(pack.id)) continue
      for (const tool of pack.tools) {
        if (!executors.has(tool)) {
          violations.push(`${pack.id} → ${tool}`)
        }
      }
    }

    expect(
      violations,
      `以下工具被声明为可用，但在 toolExecutors.ts 中找不到执行器。\n` +
      `请补齐执行器，或将其移入所在包的 reservedTools：\n  ${violations.join('\n  ')}`
    ).toEqual([])
  })

  it('工具包声明的 tools 必须在内置工具定义表中', () => {
    // ToolRegistry.register() 要求 TOOL_DEFINITIONS[name] 与 TOOL_SCHEMAS[name] 同时存在，
    // 否则会拒绝注册（只有执行器、没有工具定义同样不可用）
    const violations: string[] = []

    for (const pack of toolPackRegistry.getAll()) {
      if (SCENARIO_PROVIDED_PACKS.has(pack.id)) continue
      for (const tool of pack.tools) {
        if (!(tool in TOOL_DEFINITIONS)) {
          violations.push(`${pack.id} → ${tool}`)
        }
      }
    }

    expect(
      violations,
      `以下工具被声明为可用，但没有工具定义（toolDefinitions.ts），注册时会被拒绝：\n  ${violations.join('\n  ')}`
    ).toEqual([])
  })

  it('tools 与 reservedTools 不得重叠', () => {
    const overlaps: string[] = []

    for (const pack of toolPackRegistry.getAll()) {
      const reserved = new Set(pack.reservedTools ?? [])
      for (const tool of pack.tools) {
        if (reserved.has(tool)) overlaps.push(`${pack.id} → ${tool}`)
      }
    }

    expect(overlaps, `同一工具不能同时出现在 tools 与 reservedTools：\n  ${overlaps.join('\n  ')}`).toEqual([])
  })

  it('reservedTools 中的工具不应已有执行器（实现后须移入 tools）', () => {
    const executors = extractBuiltinExecutorNames()
    const stale: string[] = []

    for (const pack of toolPackRegistry.getAll()) {
      for (const tool of pack.reservedTools ?? []) {
        if (executors.has(tool)) stale.push(`${pack.id} → ${tool}`)
      }
    }

    expect(
      stale,
      `以下工具已有执行器，但仍被列为预留，请移入所属包的 tools：\n  ${stale.join('\n  ')}`
    ).toEqual([])
  })

  it('源码中声明的 toolPacks 必须都是已注册的工具包 id', () => {
    const declared = collectDeclaredToolPacks()
    expect(declared.length, '未扫描到任何 toolPacks 声明，测试可能失效').toBeGreaterThan(0)

    const violations: string[] = []
    for (const { file, packs } of declared) {
      const unknown = toolPackRegistry.findUnknownPacks(packs)
      if (unknown.length > 0) violations.push(`${file} → ${unknown.join(', ')}`)
    }

    expect(
      violations,
      `以下场景声明了未注册的工具包（会被静默跳过）：\n  ${violations.join('\n  ')}` +
      `\n可用工具包：${toolPackRegistry.getAll().map(p => p.id).join(', ')}`
    ).toEqual([])
  })

  it('声明 code 包不应比默认 agent 模式少工具', () => {
    const defaultTools = getToolsForContext({ mode: 'agent' })
    const codeTools = new Set(toolPackRegistry.resolveTools(['code']))

    const missing = defaultTools.filter(
      t => !codeTools.has(t) && !SYSTEM_INJECTED_TOOLS.has(t) && !LEGACY_TOOL_NAMES.has(t)
    )

    expect(
      missing,
      `以下工具在默认 agent 模式下可用，但未被 code 工具包覆盖：\n  ${missing.join('\n  ')}`
    ).toEqual([])
  })

  it('resolveReservedTools 能完整列出预留工具', () => {
    const reserved = toolPackRegistry.resolveReservedTools(['data', 'web', 'media', 'office'])
    // 依赖 code 包也会被解析，但 code 包的预留项同样属于预留集合
    expect(reserved).toEqual(
      expect.arrayContaining([
        'sql_query',
        'rest_api',
        'web_scrape',
        'image_generate',
        'doc_write',
      ])
    )
  })

  it('findUnknownPacks 能识别非法 id', () => {
    expect(toolPackRegistry.findUnknownPacks(['code', 'filesystem'])).toEqual(['filesystem'])
    expect(toolPackRegistry.findUnknownPacks(['code', 'data'])).toEqual([])
  })
})

/**
 * 场景构建器 UI 是「静默失效」的第二个入口：
 * BUILTIN_TOOL_OPTIONS 决定配置编辑器里能勾选哪些内置工具，
 * 而勾选结果最终要经 BuiltinToolRegistry.isAvailable()
 * （= AVAILABLE_BUILTIN_TOOLS.has(name) && toolRegistry.has(name)）过滤。
 * 若某工具没有执行器却能在 UI 勾选，用户会得到「勾了但场景拿不到」的配置。
 */
describe('场景构建器内置工具选项完整性', () => {
  it('UI 可勾选的内置工具必须同时具备工具定义与执行器', () => {
    const executors = extractBuiltinExecutorNames()
    const violations: string[] = []

    for (const opt of BUILTIN_TOOL_OPTIONS) {
      if (opt.reserved) continue
      const hasDefinition = opt.value in TOOL_DEFINITIONS
      const hasExecutor = executors.has(opt.value)
      if (!hasDefinition || !hasExecutor) {
        violations.push(`${opt.value}（定义:${hasDefinition ? '有' : '无'} / 执行器:${hasExecutor ? '有' : '无'}）`)
      }
    }

    expect(
      violations,
      `以下工具在配置编辑器中可勾选，但缺少工具定义或执行器，勾选后场景会静默拿不到：\n` +
      `  请补齐实现，或为其加上 reserved: true：\n  ${violations.join('\n  ')}`
    ).toEqual([])
  })

  it('标记 reserved 的内置工具必须确实没有执行器（实现后须移除标记）', () => {
    const executors = extractBuiltinExecutorNames()
    const stale = BUILTIN_TOOL_OPTIONS
      .filter(opt => opt.reserved && executors.has(opt.value))
      .map(opt => opt.value)

    expect(
      stale,
      `以下工具已有执行器，但仍被标记为 reserved，请移除该标记使其可在 UI 勾选：\n  ${stale.join('\n  ')}`
    ).toEqual([])
  })
})
