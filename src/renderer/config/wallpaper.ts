/**
 * 界面壁纸（背景图）配置
 *
 * 设计要点：
 * 1. 内置壁纸全部用 CSS 渐变与纹理绘制，不引入图片资源，离线可用、无打包体积增长；
 * 2. 用户自定义壁纸支持本地图片与网络地址，本地图片经主进程复制到用户目录后
 *    通过 wallpaper-asset:// 协议读取，避免把 base64 塞进配置存储；
 * 3. 壁纸只在根节点写入 CSS 变量与 data-wallpaper 标记，具体的层叠与透明化
 *    交给 globals.css 与 Tailwind 颜色令牌处理，组件层不需要感知壁纸是否存在。
 */

/** 壁纸铺放方式 */
export type WallpaperFit = 'cover' | 'contain' | 'repeat'

/** 壁纸来源 */
export type WallpaperKind = 'builtin' | 'image'

/** 内置壁纸定义 */
export interface BuiltinWallpaper {
  id: string
  nameZh: string
  nameEn: string
  /**
   * 该壁纸适合的界面明暗。
   *
   * 壁纸是整个页面的底色，正文与控件的配色必须与之同明暗：亮色壁纸配暗色主题
   * 会出现浅底浅字，正文与按钮几乎不可见。选壁纸时据此自动切换主题明暗，
   * 不需要用户再去手动切一次。
   */
  themeType: 'light' | 'dark'
  /** 直接用作 CSS background-image 的值（多层渐变/纹理） */
  css: string
  /** 缩略图占位底色，避免预览区在渐变未铺满时露白 */
  previewBg: string
}

/** 用户/主题当前生效的壁纸配置 */
export interface WallpaperConfig {
  /** 内置壁纸 id；自定义图片固定为 'custom' */
  id: string
  kind: WallpaperKind
  /** kind === 'image' 时的图片地址（wallpaper-asset:// 或 http(s)） */
  url?: string
  /** 高斯模糊半径，px */
  blur: number
  /** 压暗遮罩强度 0-0.9，越大越暗，用来压住壁纸以突出前景内容 */
  dim: number
  /** 面板不透明度 0.3-1，越小壁纸透出越多 */
  panelAlpha: number
  /** 铺放方式 */
  fit: WallpaperFit
}

/** 壁纸可调参数的默认值 */
export const DEFAULT_WALLPAPER_TUNING = {
  /** 默认不做模糊：内置壁纸是渐变与纹理，模糊后反而糊成一片色块 */
  blur: 0,
  /** 默认压暗 15%：只在壁纸最亮处轻微压一层，保住正文对比度又不吃掉画面 */
  dim: 0.15,
  /**
   * 默认面板不透明度 15%。
   *
   * 这个值会再乘一次大面积容器系数（见 globals.css 的 --wallpaper-surface-factor），
   * 因此会话区、左侧菜单等铺满整屏的容器实际几乎完全透出壁纸；按钮、输入框等控件
   * 仍按控件级透明度绘制，不会被壁纸纹理糊住边界。
   */
  panelAlpha: 0.15,
  fit: 'cover' as WallpaperFit,
}

/**
 * 内置壁纸库
 *
 * 全部由 CSS 分层渐变构成：最底层定基调，中间层做光斑/光带，顶层做细微纹理。
 * 暗色壁纸上字要用亮色，亮色壁纸反之，所以每套配色主题只挂同明暗的壁纸。
 * 同理，用户手动选壁纸时，主题明暗要跟着壁纸走（见 themeType）。
 */
export const BUILTIN_WALLPAPERS: BuiltinWallpaper[] = [
  {
    id: 'aurora',
    nameZh: '极光',
    nameEn: 'Aurora',
    themeType: 'dark',
    previewBg: '#0b1220',
    css:
      'radial-gradient(ellipse 80% 55% at 18% 12%, rgba(56, 189, 248, 0.34), transparent 62%),' +
      'radial-gradient(ellipse 70% 50% at 82% 8%, rgba(129, 140, 248, 0.32), transparent 60%),' +
      'radial-gradient(ellipse 90% 60% at 50% 100%, rgba(16, 185, 129, 0.20), transparent 70%),' +
      'linear-gradient(160deg, #0b1220 0%, #101a2e 45%, #0a1424 100%)',
  },
  {
    id: 'starfield',
    nameZh: '星海',
    nameEn: 'Starfield',
    themeType: 'dark',
    previewBg: '#070a14',
    css:
      'radial-gradient(1.5px 1.5px at 12% 22%, rgba(255,255,255,0.85), transparent 60%),' +
      'radial-gradient(1.5px 1.5px at 32% 68%, rgba(255,255,255,0.55), transparent 60%),' +
      'radial-gradient(1.5px 1.5px at 58% 32%, rgba(191,219,254,0.75), transparent 60%),' +
      'radial-gradient(1.5px 1.5px at 76% 74%, rgba(255,255,255,0.5), transparent 60%),' +
      'radial-gradient(1.5px 1.5px at 88% 18%, rgba(224,231,255,0.7), transparent 60%),' +
      'radial-gradient(ellipse 70% 50% at 50% 110%, rgba(59, 130, 246, 0.24), transparent 70%),' +
      'linear-gradient(180deg, #070a14 0%, #0b1120 60%, #05080f 100%)',
  },
  {
    id: 'dusk-amber',
    nameZh: '暮色琥珀',
    nameEn: 'Dusk Amber',
    themeType: 'dark',
    previewBg: '#1a0f0a',
    css:
      'radial-gradient(ellipse 60% 45% at 78% 88%, rgba(251, 146, 60, 0.30), transparent 65%),' +
      'radial-gradient(ellipse 70% 50% at 20% 15%, rgba(190, 24, 93, 0.22), transparent 62%),' +
      'linear-gradient(165deg, #1a0f0a 0%, #24120c 50%, #140a08 100%)',
  },
  {
    id: 'midnight-grid',
    nameZh: '夜幕网格',
    nameEn: 'Midnight Grid',
    themeType: 'dark',
    previewBg: '#0c0f14',
    css:
      'repeating-linear-gradient(0deg, rgba(148,163,184,0.06) 0 1px, transparent 1px 42px),' +
      'repeating-linear-gradient(90deg, rgba(148,163,184,0.06) 0 1px, transparent 1px 42px),' +
      'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(59, 130, 246, 0.14), transparent 70%),' +
      'linear-gradient(180deg, #0c0f14 0%, #0a0d12 100%)',
  },
  {
    id: 'dawn-mist',
    nameZh: '晨雾',
    nameEn: 'Dawn Mist',
    themeType: 'light',
    previewBg: '#f4f8fc',
    css:
      'radial-gradient(ellipse 70% 55% at 20% 8%, rgba(186, 230, 253, 0.75), transparent 65%),' +
      'radial-gradient(ellipse 65% 50% at 85% 25%, rgba(221, 214, 254, 0.6), transparent 62%),' +
      'radial-gradient(ellipse 90% 60% at 50% 105%, rgba(254, 240, 205, 0.55), transparent 70%),' +
      'linear-gradient(170deg, #f8fbff 0%, #eef4fb 100%)',
  },
  {
    id: 'sakura-haze',
    nameZh: '樱雾',
    nameEn: 'Sakura Haze',
    themeType: 'light',
    previewBg: '#fdf5f7',
    css:
      'radial-gradient(ellipse 65% 50% at 22% 18%, rgba(251, 207, 232, 0.85), transparent 65%),' +
      'radial-gradient(ellipse 60% 45% at 80% 12%, rgba(254, 205, 211, 0.7), transparent 62%),' +
      'radial-gradient(ellipse 85% 55% at 50% 100%, rgba(224, 231, 255, 0.7), transparent 70%),' +
      'linear-gradient(165deg, #fffafb 0%, #fdf2f6 100%)',
  },
  {
    id: 'forest-light',
    nameZh: '林隙光',
    nameEn: 'Forest Light',
    themeType: 'dark',
    previewBg: '#0b1a14',
    css:
      'radial-gradient(ellipse 45% 35% at 68% 12%, rgba(134, 239, 172, 0.28), transparent 65%),' +
      'radial-gradient(ellipse 55% 45% at 25% 45%, rgba(16, 185, 129, 0.20), transparent 65%),' +
      'repeating-linear-gradient(115deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 26px),' +
      'linear-gradient(175deg, #0b1a14 0%, #0a1512 60%, #07100d 100%)',
  },
  {
    id: 'paper-grain',
    nameZh: '宣纸',
    nameEn: 'Paper Grain',
    themeType: 'light',
    previewBg: '#faf7f0',
    css:
      'repeating-linear-gradient(92deg, rgba(120,100,70,0.035) 0 1px, transparent 1px 4px),' +
      'repeating-linear-gradient(2deg, rgba(120,100,70,0.03) 0 1px, transparent 1px 5px),' +
      'radial-gradient(ellipse 90% 60% at 50% -10%, rgba(255, 255, 255, 0.9), transparent 70%),' +
      'linear-gradient(180deg, #fbf8f1 0%, #f6f1e7 100%)',
  },
]

/** 按 id 取内置壁纸 */
export function getBuiltinWallpaper(id: string): BuiltinWallpaper | undefined {
  return BUILTIN_WALLPAPERS.find(w => w.id === id)
}

/**
 * 把壁纸配置解析成可直接写入 background-image 的 CSS 值。
 * 返回 null 表示不启用壁纸。
 */
export function resolveWallpaperImage(config: WallpaperConfig | null | undefined): string | null {
  if (!config) return null
  if (config.kind === 'image') {
    const url = (config.url || '').trim()
    if (!url) return null
    // 只放行本地壁纸协议与 http(s)，其余（file://、javascript: 等）一律忽略
    if (!/^(wallpaper-asset:\/\/|https?:\/\/|data:image\/)/i.test(url)) return null
    return `url("${url.replace(/["\\]/g, '')}")`
  }
  const builtin = getBuiltinWallpaper(config.id)
  return builtin ? builtin.css : null
}

/** 把 fit 转换成 background-size / background-repeat */
function resolveFit(fit: WallpaperFit): { size: string; repeat: string } {
  if (fit === 'contain') return { size: 'contain', repeat: 'no-repeat' }
  if (fit === 'repeat') return { size: 'auto', repeat: 'repeat' }
  return { size: 'cover', repeat: 'no-repeat' }
}

/**
 * 把壁纸配置写入根节点。
 *
 * 关键变量：
 * - --wallpaper-image  壁纸层背景图
 * - --wallpaper-dim    压暗遮罩强度
 * - --wallpaper-blur   模糊半径（作用在壁纸层，不影响内容）
 * - --panel-alpha      面板不透明度，由 Tailwind 颜色令牌消费
 */
export function applyWallpaper(config: WallpaperConfig | null | undefined): void {
  const root = document.documentElement
  const image = resolveWallpaperImage(config)

  if (!config || !image) {
    root.removeAttribute('data-wallpaper')
    root.style.removeProperty('--wallpaper-image')
    root.style.removeProperty('--wallpaper-dim')
    root.style.removeProperty('--wallpaper-blur')
    root.style.removeProperty('--wallpaper-size')
    root.style.removeProperty('--wallpaper-repeat')
    root.style.removeProperty('--panel-alpha')
    return
  }

  const fit = resolveFit(config.fit)
  root.setAttribute('data-wallpaper', 'on')
  root.style.setProperty('--wallpaper-image', image)
  root.style.setProperty('--wallpaper-dim', String(clamp(config.dim, 0, 0.9)))
  root.style.setProperty('--wallpaper-blur', `${clamp(config.blur, 0, 40)}px`)
  root.style.setProperty('--wallpaper-size', fit.size)
  root.style.setProperty('--wallpaper-repeat', fit.repeat)
  root.style.setProperty('--panel-alpha', String(clamp(config.panelAlpha, 0.3, 1)))
}

function clamp(value: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** 校验来自存储的壁纸配置，剔除脏数据 */
export function isValidWallpaperConfig(value: unknown): value is WallpaperConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as Record<string, unknown>
  if (config.kind !== 'builtin' && config.kind !== 'image') return false
  if (typeof config.id !== 'string') return false
  if (config.kind === 'image' && typeof config.url !== 'string') return false
  if (config.kind === 'builtin' && !getBuiltinWallpaper(config.id)) return false
  return true
}

/** 用默认调参补齐缺省字段 */
export function normalizeWallpaperConfig(value: Partial<WallpaperConfig>): WallpaperConfig {
  return {
    id: value.id || 'custom',
    kind: value.kind === 'image' ? 'image' : 'builtin',
    url: value.url,
    blur: typeof value.blur === 'number' ? value.blur : DEFAULT_WALLPAPER_TUNING.blur,
    dim: typeof value.dim === 'number' ? value.dim : DEFAULT_WALLPAPER_TUNING.dim,
    panelAlpha:
      typeof value.panelAlpha === 'number' ? value.panelAlpha : DEFAULT_WALLPAPER_TUNING.panelAlpha,
    fit: value.fit === 'contain' || value.fit === 'repeat' ? value.fit : 'cover',
  }
}

/**
 * 用户保存的自定义壁纸主题
 *
 * 一套自定义壁纸主题 = 壁纸本身（含模糊/遮罩/面板不透明度/铺放四个滑块参数）
 * + 保存时的界面明暗与配色。切换回头时三部分一起恢复，避免只换图不换配色
 * 导致浅底浅字。
 */
export interface CustomWallpaperTheme {
  id: string
  /** 用户起的名称，重名允许（用 id 区分） */
  name: string
  /** 壁纸与滑块参数 */
  wallpaper: WallpaperConfig
  /** 保存时的界面明暗设置，'system' 表示跟随系统 */
  themeMode: 'light' | 'dark' | 'system'
  /** 保存时的配色主题 id（对应 builtinColorThemes 的 id） */
  colorThemeId: string
  createdAt: number
  updatedAt: number
}

/** 两份壁纸配置是否完全一致（用于判断某套自定义主题当前是否处于选中态） */
export function isSameWallpaperConfig(
  a: WallpaperConfig | null | undefined,
  b: WallpaperConfig | null | undefined
): boolean {
  if (!a || !b) return a === b
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    (a.url ?? '') === (b.url ?? '') &&
    a.blur === b.blur &&
    a.dim === b.dim &&
    a.panelAlpha === b.panelAlpha &&
    a.fit === b.fit
  )
}

/** 校验来自存储的自定义壁纸主题，剔除脏数据后返回规范化结果 */
export function normalizeCustomWallpaperTheme(
  value: unknown
): CustomWallpaperTheme | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null
  if (!isValidWallpaperConfig(raw.wallpaper)) return null

  const mode = raw.themeMode
  const themeMode: CustomWallpaperTheme['themeMode'] =
    mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'light'

  return {
    id: raw.id,
    name: raw.name.trim(),
    wallpaper: normalizeWallpaperConfig(raw.wallpaper),
    themeMode,
    colorThemeId: typeof raw.colorThemeId === 'string' && raw.colorThemeId ? raw.colorThemeId : 'aweeclaw',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  }
}
