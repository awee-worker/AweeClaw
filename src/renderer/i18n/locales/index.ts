/**
 * 文案域装载器
 *
 * 文案表按命名空间拆成多个域文件，每个域一个模块（中英各一份）。
 * 这里用 Vite 的 glob 动态导入收集：未被引用的域不会被加载，
 * 且「只加载当前语言」把另一份文案整体推迟到切换语言时才取。
 *
 * 域划分的边界由 `DOMAINS` 决定，命名空间到域的映射在拆分时固化；
 * 新增命名空间时对应地补一个域文件即可，装载逻辑无需改动。
 *
 * @module i18n/locales
 */

/** 文案域标识 */
export const DOMAINS = [
  'app',
  'settings',
  'desktop',
  'ai',
  'workflow',
  'editor',
  'shell',
  'content',
  'space',
  'iot',
  'misc',
] as const

export type LocaleDomain = (typeof DOMAINS)[number]

/** 中文域模块（键为相对路径，值为动态导入函数） */
const zhModules = import.meta.glob<{ zh: Record<string, string> }>('./zhCN/*.ts')

/** 英文域模块 */
const enModules = import.meta.glob<{ en: Record<string, string> }>('./enUS/*.ts')

/**
 * 加载某语言的全部域并合并成扁平字典。
 *
 * 各域之间键名互不重叠（按命名空间切分），因此合并顺序不影响结果。
 * 加载失败会让整个语言不可用，这里不做静默兜底 ——
 * 文案缺失比抛错更难排查，调用方据此决定是否降级。
 */
export async function loadLocaleDict(lang: 'zh' | 'en'): Promise<Record<string, string>> {
  const isZh = lang === 'zh'
  const modules = isZh ? zhModules : enModules
  const dict: Record<string, string> = {}

  const loaded = await Promise.all(Object.values(modules).map((load) => load()))
  for (const mod of loaded) {
    const part = isZh ? (mod as { zh?: Record<string, string> }).zh : (mod as { en?: Record<string, string> }).en
    if (part) Object.assign(dict, part)
  }
  return dict
}
