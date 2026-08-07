/**
 * .pptx 文件 OOXML 解析器（v2：WPS 兼容版）
 *
 * 从 .pptx（OOXML）压缩包中提取幻灯片数据，转换为 PptSlideData 格式，
 * 供 SlideCanvas 渲染（与 mcp-pptx 插件生成的预览数据格式一致）。
 *
 * v2 增强（解决 WPS 制作的 .pptx 内容错乱问题）：
 * 1. **主题色解析**：读取 ppt/theme/theme1.xml 的 clrScheme，将 <a:schemeClr val="accent1"/>
 *    等主题色引用解析为实际 RGB 色（WPS 大量使用 schemeClr 而非 srgbClr）
 * 2. **颜色变换支持**：schemeClr 的子元素如 <a:lumMod>/<a:shade> 等亮度/色相变换
 *    （简化处理：仅应用 lumMod/lumOff 的近似变换）
 * 3. **AlternateContent 兼容**：WPS/新版 Office 用 <mc:AlternateContent> 包裹元素，
 *    优先取 <mc:Choice>，降级取 <mc:Fallback>
 * 4. **背景继承**：当 slide 无显式背景时，从 slideLayout/slideMaster 继承
 * 5. **元素级容错**：单个元素解析失败不中断整张幻灯片
 * 6. **空文本框过滤**：跳过无文字、无填充、无边框的占位形状
 *
 * 设计要点：
 * - 使用 JSZip 解压 .pptx（本质是 ZIP）
 * - 使用 DOMParser 解析 XML（浏览器原生，无额外依赖）
 * - 坐标单位：EMU → 英寸（/ 914400）
 * - 字号单位：1/100 磅 → 磅（/ 100）
 * - 颜色：srgbClr val="RRGGBB" 或 schemeClr val="accent1" → #RRGGBB
 * - 图片：通过 .rels 解析 rId → 媒体文件，内联为 data URI
 *
 * 限制：
 * - 图表降级为占位文本（pptxgenjs 图表数据结构复杂，无法从 OOXML 简单还原）
 * - SmartArt 降级为占位文本
 * - 渐变填充仅取纯色
 * - 主题色亮度变换为近似算法（HSL 准确变换代价过高）
 */

import JSZip from 'jszip'
import type {
  PptSlideData,
  PptElement,
  PptTextElement,
  PptShapeElement,
  PptSlideBackground,
} from '@shared/protocols/pptPreviewProtocol'

// ============================================
// 常量
// ============================================

/** EMU → 英寸换算（1 英寸 = 914400 EMU） */
const EMU_PER_INCH = 914400

/** OOXML 命名空间前缀 → URI 映射 */
const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
}

/** DOMParser 单例 */
const parser = new DOMParser()

/** 主题色名 → 默认色（兜底，当 theme1.xml 缺失或某项未定义时使用） */
const DEFAULT_THEME_COLORS: Record<string, string> = {
  dk1: '#000000',
  lt1: '#FFFFFF',
  dk2: '#44546A',
  lt2: '#E7E6E6',
  accent1: '#4472C4',
  accent2: '#ED7D31',
  accent3: '#A5A5A5',
  accent4: '#FFC000',
  accent5: '#5B9BD5',
  accent6: '#70AD47',
  hlt: '#FF0000',
  tx1: '#000000',
  bg1: '#FFFFFF',
  tx2: '#44546A',
  bg2: '#E7E6E6',
}

// ============================================
// 主入口
// ============================================

export interface ParsedPresentation {
  slides: PptSlideData[]
  slideSize: { width: number; height: number }
  title: string
}

/**
 * 解析 base64 编码的 .pptx 文件
 */
export async function parsePptxFromBase64(base64: string): Promise<ParsedPresentation> {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return parsePptxBytes(bytes)
}

/** 解析 .pptx 字节流 */
async function parsePptxBytes(bytes: Uint8Array): Promise<ParsedPresentation> {
  const zip = await JSZip.loadAsync(bytes)

  // 1. 演示文稿元信息（尺寸 + 标题）
  const { slideSize, title } = await parsePresentationMeta(zip)

  // 2. 主题色表（关键：WPS 大量使用 schemeClr，必须先解析）
  const themeColors = await parseThemeColors(zip)

  // 3. 收集幻灯片文件（按编号排序）
  const slideFiles = collectSlideFiles(zip)

  // 4. 预构建每张幻灯片的 rId → 媒体 dataURI 映射
  const slideMediaMaps = new Map<number, Map<string, string>>()
  for (const sf of slideFiles) {
    const mediaMap = await buildSlideMediaMap(zip, sf.num)
    slideMediaMaps.set(sf.num, mediaMap)
  }

  // 5. 预解析 slideLayout/slideMaster 的背景（供幻灯片继承）
  const layoutBackgrounds = new Map<number, PptSlideBackground | undefined>()
  for (const sf of slideFiles) {
    const bg = await parseSlideLayoutBackground(zip, sf.num, themeColors)
    layoutBackgrounds.set(sf.num, bg)
  }

  // 6. 逐张解析幻灯片
  const slides: PptSlideData[] = []
  for (let i = 0; i < slideFiles.length; i++) {
    const { name, num } = slideFiles[i]
    const xmlContent = await zip.file(name)?.async('string')
    if (!xmlContent) continue
    const mediaMap = slideMediaMaps.get(num) || new Map()
    const fallbackBg = layoutBackgrounds.get(num)
    const slideData = parseSlideXml(xmlContent, num - 1, mediaMap, themeColors, fallbackBg)
    slides.push(slideData)
  }

  return { slides, slideSize, title }
}

// ============================================
// 元信息解析
// ============================================

async function parsePresentationMeta(
  zip: JSZip,
): Promise<{ slideSize: { width: number; height: number }; title: string }> {
  let slideSize = { width: 10, height: 5.625 } // 默认 16:9
  let title = 'PowerPoint 演示文稿'

  const presXml = await zip.file('ppt/presentation.xml')?.async('string')
  if (presXml) {
    const doc = parser.parseFromString(presXml, 'application/xml')
    const sldSz = doc.getElementsByTagNameNS(NS.p, 'sldSz')[0]
    if (sldSz) {
      const cx = parseInt(sldSz.getAttribute('cx') || '0', 10)
      const cy = parseInt(sldSz.getAttribute('cy') || '0', 10)
      if (cx > 0 && cy > 0) {
        slideSize = {
          width: cx / EMU_PER_INCH,
          height: cy / EMU_PER_INCH,
        }
      }
    }
  }

  const coreXml = await zip.file('docProps/core.xml')?.async('string')
  if (coreXml) {
    const doc = parser.parseFromString(coreXml, 'application/xml')
    const titleEl = doc.getElementsByTagName('dc:title')[0]
    if (titleEl && titleEl.textContent) {
      title = titleEl.textContent.trim()
    }
  }

  return { slideSize, title }
}

/** 收集并排序幻灯片文件 */
function collectSlideFiles(zip: JSZip): { name: string; num: number }[] {
  const files: { name: string; num: number }[] = []
  zip.forEach((relativePath) => {
    const match = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/)
    if (match) {
      files.push({ name: relativePath, num: parseInt(match[1], 10) })
    }
  })
  files.sort((a, b) => a.num - b.num)
  return files
}

// ============================================
// 主题色解析（WPS 兼容关键）
// ============================================

/**
 * 解析 ppt/theme/theme1.xml 的颜色方案，建立 schemeClr val → #RRGGBB 映射。
 * WPS 制作的 PPT 大量使用 schemeClr，必须先解析此表，否则颜色全部丢失。
 *
 * 主题色名映射（OOXML 标准）：
 *   dk1/lt1 → 暗色1/亮色1（基本文字/背景）
 *   dk2/lt2 → 暗色2/亮色2
 *   accent1~accent6 → 6 个强调色
 *   hlt → 高亮色
 *
 * 注意：OOXML 中 <a:clrScheme> 的子元素名是 dk1/lt1/dk2/lt2/accent1 等，
 * 但 <a:schemeClr val="..."/> 的 val 可能是 dk1/lt1 或 bg1/tx1（后者通过 clrMap 映射）。
 * 这里为简化处理，同时缓存两套名称。
 */
async function parseThemeColors(zip: JSZip): Promise<Map<string, string>> {
  const colorMap = new Map<string, string>()

  // 先填充默认色（兜底）
  for (const [k, v] of Object.entries(DEFAULT_THEME_COLORS)) {
    colorMap.set(k, v)
  }

  const themeXml = await zip.file('ppt/theme/theme1.xml')?.async('string')
  if (!themeXml) return colorMap

  const doc = parser.parseFromString(themeXml, 'application/xml')
  const clrScheme = doc.getElementsByTagNameNS(NS.a, 'clrScheme')[0]
  if (!clrScheme) return colorMap

  // 遍历 clrScheme 的直接子元素（dk1/lt1/dk2/lt2/accent1...）
  for (let i = 0; i < clrScheme.children.length; i++) {
    const child = clrScheme.children[i]
    const name = child.localName // dk1, lt1, accent1, etc.
    const color = extractColorFromElement(child, colorMap)
    if (color) {
      colorMap.set(name, color)
      // bg1/tx1 通常等于 lt1/dk1（或反之，取决于 clrMap，简化处理同时缓存）
      if (name === 'dk1') {
        colorMap.set('tx1', color)
        colorMap.set('bg1', colorMap.get('lt1') || '#FFFFFF')
      } else if (name === 'lt1') {
        colorMap.set('bg1', color)
        colorMap.set('tx1', colorMap.get('dk1') || '#000000')
      } else if (name === 'dk2') {
        colorMap.set('tx2', color)
      } else if (name === 'lt2') {
        colorMap.set('bg2', color)
      }
    }
  }

  return colorMap
}

/**
 * 从颜色父元素（如 <a:dk1>）中提取颜色，支持 srgbClr 和 schemeClr。
 * @param parent 包含颜色定义的元素（如 <a:dk1><a:srgbClr val="44546A"/></a:dk1>）
 * @param themeColors 主题色表（用于解析嵌套的 schemeClr 引用）
 */
function extractColorFromElement(parent: Element, themeColors: Map<string, string>): string | undefined {
  // 优先 srgbClr（直接 RGB）
  const srgbClr = parent.getElementsByTagNameNS(NS.a, 'srgbClr')[0]
  if (srgbClr) {
    const val = srgbClr.getAttribute('val')
    if (val) return '#' + val.toUpperCase()
  }

  // 降级 schemeClr（主题色引用，WPS 常用）
  const schemeClr = parent.getElementsByTagNameNS(NS.a, 'schemeClr')[0]
  if (schemeClr) {
    const val = schemeClr.getAttribute('val')
    if (val) {
      // 应用亮度变换（如 <a:schemeClr val="accent1"><a:lumMod val="60000"/></a:schemeClr>）
      const baseColor = themeColors.get(val) || DEFAULT_THEME_COLORS[val] || '#000000'
      return applyColorTransforms(baseColor, schemeClr)
    }
  }

  // 降级 systemClr（系统色，如 windowText/window）
  const systemClr = parent.getElementsByTagNameNS(NS.a, 'systemClr')[0]
  if (systemClr) {
    const val = systemClr.getAttribute('lastClr')
    if (val) return '#' + val.toUpperCase()
  }

  return undefined
}

/**
 * 应用颜色变换（lumMod 亮度调节、lumOff 亮度偏移、shade/shade 暗化等）
 * 简化算法：仅处理最常见的 lumMod，将颜色按比例向黑/白混合
 */
function applyColorTransforms(baseColor: string, schemeClrElement: Element): string {
  const hex = baseColor.replace('#', '')
  if (hex.length !== 6) return baseColor

  let r = parseInt(hex.slice(0, 2), 16)
  let g = parseInt(hex.slice(2, 4), 16)
  let b = parseInt(hex.slice(4, 6), 16)

  const lumMod = schemeClrElement.getElementsByTagNameNS(NS.a, 'lumMod')[0]
  const lumOff = schemeClrElement.getElementsByTagNameNS(NS.a, 'lumOff')[0]
  const shade = schemeClrElement.getElementsByTagNameNS(NS.a, 'shade')[0]
  const tint = schemeClrElement.getElementsByTagNameNS(NS.a, 'tint')[0]

  // lumMod：亮度系数（百分比/100000），如 60000 = 60% 亮度
  if (lumMod) {
    const factor = parseInt(lumMod.getAttribute('val') || '100000', 10) / 100000
    r = Math.round(r * factor)
    g = Math.round(g * factor)
    b = Math.round(b * factor)
  }

  // lumOff：亮度偏移（百分比/100000），如 40000 = 向白色偏移 40%
  if (lumOff) {
    const offset = parseInt(lumOff.getAttribute('val') || '0', 10) / 100000
    r = Math.round(r + (255 - r) * offset)
    g = Math.round(g + (255 - g) * offset)
    b = Math.round(b + (255 - b) * offset)
  }

  // shade：暗化（值越小越暗）
  if (shade) {
    const factor = parseInt(shade.getAttribute('val') || '100000', 10) / 100000
    r = Math.round(r * factor)
    g = Math.round(g * factor)
    b = Math.round(b * factor)
  }

  // tint：淡化为白色（值越小越白）
  if (tint) {
    const factor = 1 - parseInt(tint.getAttribute('val') || '0', 10) / 100000
    r = Math.round(r + (255 - r) * factor)
    g = Math.round(g + (255 - g) * factor)
    b = Math.round(b + (255 - b) * factor)
  }

  r = Math.min(255, Math.max(0, r))
  g = Math.min(255, Math.max(0, g))
  b = Math.min(255, Math.max(0, b))
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// ============================================
// 媒体文件解析
// ============================================

async function buildSlideMediaMap(
  zip: JSZip,
  slideNum: number,
): Promise<Map<string, string>> {
  const mediaMap = new Map<string, string>()
  const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`
  const relsXml = await zip.file(relsPath)?.async('string')
  if (!relsXml) return mediaMap

  const doc = parser.parseFromString(relsXml, 'application/xml')
  const rels = doc.getElementsByTagName('Relationship')
  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i]
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    const type = rel.getAttribute('Type') || ''
    if (!id || !target || !type.includes('image')) continue

    const mediaPath = normalizeZipPath('ppt/slides', target)
    const file = zip.file(mediaPath)
    if (!file) continue

    try {
      const base64 = await file.async('base64')
      const ext = mediaPath.split('.').pop()?.toLowerCase() || 'png'
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
      mediaMap.set(id, `data:${mime};base64,${base64}`)
    } catch {
      // 静默跳过
    }
  }
  return mediaMap
}

function normalizeZipPath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (baseDir + '/' + target).split('/')
  const resolved: string[] = []
  for (const p of parts) {
    if (p === '..') resolved.pop()
    else if (p !== '.' && p !== '') resolved.push(p)
  }
  return resolved.join('/')
}

// ============================================
// slideLayout 背景继承
// ============================================

/**
 * 解析 slideLayout/slideMaster 的背景色，作为 slide 没有显式背景时的兜底。
 * 路径：ppt/slideLayouts/slideLayoutN.xml + ppt/slideMasters/slideMasterN.xml
 */
async function parseSlideLayoutBackground(
  zip: JSZip,
  slideNum: number,
  themeColors: Map<string, string>,
): Promise<PptSlideBackground | undefined> {
  // 1. 从 slideN.xml.rels 找到对应的 slideLayout
  const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`
  const relsXml = await zip.file(relsPath)?.async('string')
  if (!relsXml) return undefined

  const relsDoc = parser.parseFromString(relsXml, 'application/xml')
  const rels = relsDoc.getElementsByTagName('Relationship')
  let layoutPath: string | null = null
  for (let i = 0; i < rels.length; i++) {
    const type = rels[i].getAttribute('Type') || ''
    if (type.includes('slideLayout')) {
      const target = rels[i].getAttribute('Target')
      if (target) {
        layoutPath = normalizeZipPath('ppt/slides', target)
      }
      break
    }
  }
  if (!layoutPath) return undefined

  // 2. 解析 slideLayout 背景
  const layoutXml = await zip.file(layoutPath)?.async('string')
  if (!layoutXml) return undefined
  const layoutDoc = parser.parseFromString(layoutXml, 'application/xml')
  const layoutBg = extractBackgroundFromElement(layoutDoc.documentElement, themeColors)
  if (layoutBg) return layoutBg

  // 3. 降级到 slideMaster（路径推导：slideLayoutN.xml.rels 找 slideMaster）
  const layoutNum = layoutPath.match(/slideLayout(\d+)\.xml/)?.[1]
  if (!layoutNum) return undefined
  const layoutRelsPath = `ppt/slideLayouts/_rels/slideLayout${layoutNum}.xml.rels`
  const layoutRelsXml = await zip.file(layoutRelsPath)?.async('string')
  if (!layoutRelsXml) return undefined

  const layoutRelsDoc = parser.parseFromString(layoutRelsXml, 'application/xml')
  const layoutRels = layoutRelsDoc.getElementsByTagName('Relationship')
  let masterPath: string | null = null
  for (let i = 0; i < layoutRels.length; i++) {
    const type = layoutRels[i].getAttribute('Type') || ''
    if (type.includes('slideMaster')) {
      const target = layoutRels[i].getAttribute('Target')
      if (target) masterPath = normalizeZipPath('ppt/slideLayouts', target)
      break
    }
  }
  if (!masterPath) return undefined

  const masterXml = await zip.file(masterPath)?.async('string')
  if (!masterXml) return undefined
  const masterDoc = parser.parseFromString(masterXml, 'application/xml')
  return extractBackgroundFromElement(masterDoc.documentElement, themeColors)
}

/** 从 <p:sld>/<p:sldLayout>/<p:sldMaster> 元素中提取背景色 */
function extractBackgroundFromElement(
  root: Element,
  themeColors: Map<string, string>,
): PptSlideBackground | undefined {
  const bg = root.getElementsByTagNameNS(NS.p, 'bg')[0]
  if (!bg) return undefined
  const bgPr = bg.getElementsByTagNameNS(NS.p, 'bgPr')[0]
  if (!bgPr) return undefined
  const solidFill = bgPr.getElementsByTagNameNS(NS.a, 'solidFill')[0]
  if (!solidFill) return undefined
  const color = extractColorFromElement(solidFill, themeColors)
  return color ? { color } : undefined
}

// ============================================
// 单张幻灯片解析
// ============================================

function parseSlideXml(
  xmlContent: string,
  slideIndex: number,
  mediaMap: Map<string, string>,
  themeColors: Map<string, string>,
  fallbackBg?: PptSlideBackground,
): PptSlideData {
  const doc = parser.parseFromString(xmlContent, 'application/xml')
  const slideEl = doc.documentElement

  const elements: PptElement[] = []
  let background: PptSlideBackground | undefined = fallbackBg
  let title: string | undefined

  // 1. 背景（slide 自身背景优先于 layout/master 继承）
  const slideBg = extractBackgroundFromElement(slideEl, themeColors)
  if (slideBg) background = slideBg

  // 2. 解析 spTree（shape tree）下的所有元素
  // OOXML 中元素位于 <p:cSld><p:spTree> 下
  const spTree = slideEl.getElementsByTagNameNS(NS.p, 'spTree')[0]
  if (!spTree) {
    return { sessionId: 'workspace-file', slideIndex, title, background, elements }
  }

  // 3. 遍历 spTree 直接子元素（保持 z-order）
  // WPS/Office 用 mc:AlternateContent 包裹兼容元素，需特殊处理
  for (let i = 0; i < spTree.children.length; i++) {
    const child = spTree.children[i]
    const localName = child.localName

    // 跳过 grpSp（组合形状，内部结构复杂，单独解析）
    if (localName === 'grpSp') {
      try {
        const grpElements = parseGroupShape(child, mediaMap, themeColors)
        elements.push(...grpElements)
      } catch {
        // 容错：组合解析失败不影响其它元素
      }
      continue
    }

    // 处理 AlternateContent：取 Choice 优先，降级 Fallback
    if (localName === 'AlternateContent' && child.namespaceURI === NS.mc) {
      const choice = child.getElementsByTagNameNS(NS.mc, 'Choice')[0]
      const target = choice || child.getElementsByTagNameNS(NS.mc, 'Fallback')[0]
      if (target && target.firstElementChild) {
        const innerEl = target.firstElementChild
        const el = parseElementByTagName(innerEl, mediaMap, themeColors)
        if (el) {
          elements.push(el)
          if (!title && el.type === 'text' && el.text.trim()) {
            title = el.text.split('\n')[0].trim()
          }
        }
      }
      continue
    }

    // 标准元素分发
    const el = parseElementByTagName(child, mediaMap, themeColors)
    if (el) {
      elements.push(el)
      if (!title && el.type === 'text' && el.text.trim()) {
        title = el.text.split('\n')[0].trim()
      }
    }
  }

  return { sessionId: 'workspace-file', slideIndex, title, background, elements }
}

/** 按元素标签名分发解析 */
function parseElementByTagName(
  el: Element,
  mediaMap: Map<string, string>,
  themeColors: Map<string, string>,
): PptElement | null {
  const localName = el.localName
  const ns = el.namespaceURI

  try {
    if (ns === NS.p && localName === 'sp') {
      return parseShape(el, themeColors)
    }
    if (ns === NS.p && localName === 'pic') {
      return parsePicture(el, mediaMap)
    }
    if (ns === NS.p && localName === 'graphicFrame') {
      return parseGraphicFrame(el, themeColors)
    }
  } catch {
    // 单元素解析失败不影响整张幻灯片
    return null
  }
  return null
}

// ============================================
// 形状解析（p:sp）
// ============================================

function parseShape(sp: Element, themeColors: Map<string, string>): PptElement | null {
  const xfrm = sp.getElementsByTagNameNS(NS.a, 'xfrm')[0]
  if (!xfrm) return null
  const off = xfrm.getElementsByTagNameNS(NS.a, 'off')[0]
  const ext = xfrm.getElementsByTagNameNS(NS.a, 'ext')[0]
  if (!off || !ext) return null

  const x = parseInt(off.getAttribute('x') || '0', 10) / EMU_PER_INCH
  const y = parseInt(off.getAttribute('y') || '0', 10) / EMU_PER_INCH
  const w = parseInt(ext.getAttribute('cx') || '0', 10) / EMU_PER_INCH
  const h = parseInt(ext.getAttribute('cy') || '0', 10) / EMU_PER_INCH
  if (w <= 0 || h <= 0) return null

  const spPr = sp.getElementsByTagNameNS(NS.p, 'spPr')[0]
  const prstGeom = spPr?.getElementsByTagNameNS(NS.a, 'prstGeom')[0]
  const prst = prstGeom?.getAttribute('prst') || 'rect'

  const fill = spPr ? extractFill(spPr, themeColors) : undefined
  const ln = spPr?.getElementsByTagNameNS(NS.a, 'ln')[0]
  const line = ln ? extractFill(ln, themeColors) : undefined
  const lineWidth = ln ? extractLineWidth(ln) : undefined
  const rot = xfrm.getAttribute('rot')
  const rotate = rot ? parseInt(rot, 10) / 60000 : undefined

  // 文本内容
  const txBody = sp.getElementsByTagNameNS(NS.p, 'txBody')[0]
  const textInfo = txBody ? parseTextBody(txBody, themeColors) : null

  if (textInfo && textInfo.text) {
    const firstRun = textInfo.runs[0]
    const textElement: PptTextElement = {
      type: 'text',
      x,
      y,
      w,
      h,
      text: textInfo.text,
      fontSize: firstRun?.fontSize || 18,
      color: firstRun?.color || '#333333',
      bold: firstRun?.bold,
      italic: firstRun?.italic,
      align: textInfo.align || 'left',
      valign: 'top',
      fill,
    }
    return textElement
  }

  // 无文本 → 形状元素
  // 跳过完全无视觉的形状（无填充、无边框）以减少噪音
  if (!fill && !line) return null

  const shapeMap: Record<string, PptShapeElement['shape']> = {
    rect: 'rect',
    roundRect: 'roundRect',
    ellipse: 'ellipse',
    line: 'line',
    triangle: 'triangle',
    chevron: 'chevron',
    rightArrow: 'arrow',
    arrow: 'arrow',
  }
  const shapeElement: PptShapeElement = {
    type: 'shape',
    shape: shapeMap[prst] || 'rect',
    x,
    y,
    w,
    h,
    fill,
    line,
    lineWidth,
    rotate,
  }
  return shapeElement
}

// ============================================
// 组合形状（p:grpSp）解析
// ============================================

function parseGroupShape(
  grpSp: Element,
  mediaMap: Map<string, string>,
  themeColors: Map<string, string>,
): PptElement[] {
  const elements: PptElement[] = []
  // 遍历组合内的所有子形状
  for (let i = 0; i < grpSp.children.length; i++) {
    const child = grpSp.children[i]
    const el = parseElementByTagName(child, mediaMap, themeColors)
    if (el) elements.push(el)
  }
  return elements
}

// ============================================
// 文本解析
// ============================================

interface TextRunInfo {
  text: string
  fontSize: number
  color: string
  bold: boolean
  italic: boolean
}

interface TextBodyInfo {
  text: string
  runs: TextRunInfo[]
  align?: 'left' | 'center' | 'right'
}

function parseTextBody(txBody: Element, themeColors: Map<string, string>): TextBodyInfo | null {
  const paragraphs = txBody.getElementsByTagNameNS(NS.a, 'p')
  if (paragraphs.length === 0) return null

  const lines: string[] = []
  const runs: TextRunInfo[] = []
  let align: 'left' | 'center' | 'right' | undefined

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const pPr = p.getElementsByTagNameNS(NS.a, 'pPr')[0]
    if (pPr) {
      const algn = pPr.getAttribute('algn')
      if (algn === 'ctr') align = 'center'
      else if (algn === 'r') align = 'right'
      else if (algn === 'l') align = 'left'
    }

    const runEls = p.getElementsByTagNameNS(NS.a, 'r')
    let lineText = ''
    for (let j = 0; j < runEls.length; j++) {
      const r = runEls[j]
      const rPr = r.getElementsByTagNameNS(NS.a, 'rPr')[0]
      const t = r.getElementsByTagNameNS(NS.a, 't')[0]
      const text = t?.textContent || ''
      lineText += text

      if (text) {
        // 默认文字色取自 <a:lstStyle>/<a:defRPr>，简化为深灰
        let color = '#333333'
        if (rPr) {
          const c = extractColorFromElement(rPr, themeColors)
          if (c) color = c
        }
        runs.push({
          text,
          fontSize: rPr ? parseFontSize(rPr) : 18,
          color,
          bold: rPr?.getAttribute('b') === '1',
          italic: rPr?.getAttribute('i') === '1',
        })
      }
    }
    lines.push(lineText)
  }

  return { text: lines.join('\n'), runs, align }
}

function parseFontSize(rPr: Element): number {
  const sz = rPr.getAttribute('sz')
  if (!sz) return 18
  const pt = parseInt(sz, 10) / 100
  return pt > 0 ? pt : 18
}

// ============================================
// 图片解析（p:pic）
// ============================================

function parsePicture(pic: Element, mediaMap: Map<string, string>): PptElement | null {
  const xfrm = pic.getElementsByTagNameNS(NS.a, 'xfrm')[0]
  if (!xfrm) return null
  const off = xfrm.getElementsByTagNameNS(NS.a, 'off')[0]
  const ext = xfrm.getElementsByTagNameNS(NS.a, 'ext')[0]
  if (!off || !ext) return null

  const x = parseInt(off.getAttribute('x') || '0', 10) / EMU_PER_INCH
  const y = parseInt(off.getAttribute('y') || '0', 10) / EMU_PER_INCH
  const w = parseInt(ext.getAttribute('cx') || '0', 10) / EMU_PER_INCH
  const h = parseInt(ext.getAttribute('cy') || '0', 10) / EMU_PER_INCH
  if (w <= 0 || h <= 0) return null

  const blip = pic.getElementsByTagNameNS(NS.a, 'blip')[0]
  if (!blip) return null
  const embedId = blip.getAttributeNS(NS.r, 'embed')
  if (!embedId) return null

  const src = mediaMap.get(embedId)
  if (!src) return null

  const rot = xfrm.getAttribute('rot')
  const rotate = rot ? parseInt(rot, 10) / 60000 : undefined

  return {
    type: 'image',
    x,
    y,
    w,
    h,
    src,
    rotate,
  }
}

// ============================================
// 图形框解析（表格/图表）
// ============================================

function parseGraphicFrame(gf: Element, themeColors: Map<string, string>): PptElement | null {
  const xfrm = gf.getElementsByTagNameNS(NS.a, 'xfrm')[0]
  if (!xfrm) return null
  const off = xfrm.getElementsByTagNameNS(NS.a, 'off')[0]
  const ext = xfrm.getElementsByTagNameNS(NS.a, 'ext')[0]
  if (!off || !ext) return null

  const x = parseInt(off.getAttribute('x') || '0', 10) / EMU_PER_INCH
  const y = parseInt(off.getAttribute('y') || '0', 10) / EMU_PER_INCH
  const w = parseInt(ext.getAttribute('cx') || '0', 10) / EMU_PER_INCH
  const h = parseInt(ext.getAttribute('cy') || '0', 10) / EMU_PER_INCH
  if (w <= 0 || h <= 0) return null

  const tbl = gf.getElementsByTagNameNS(NS.a, 'tbl')[0]
  if (tbl) {
    return parseTable(tbl, x, y, w, h, themeColors)
  }

  return {
    type: 'text',
    x,
    y,
    w,
    h,
    text: '[图表]',
    fontSize: 14,
    color: '#999999',
    align: 'center',
    valign: 'middle',
  }
}

function parseTable(
  tbl: Element,
  x: number,
  y: number,
  w: number,
  h: number,
  themeColors: Map<string, string>,
): PptElement {
  const trs = tbl.getElementsByTagNameNS(NS.a, 'tr')
  const rows: string[][] = []

  for (let i = 0; i < trs.length; i++) {
    const tcs = trs[i].getElementsByTagNameNS(NS.a, 'tc')
    const row: string[] = []
    for (let j = 0; j < tcs.length; j++) {
      const texts = tcs[j].getElementsByTagNameNS(NS.a, 't')
      let cellText = ''
      for (let k = 0; k < texts.length; k++) {
        cellText += texts[k].textContent || ''
      }
      row.push(cellText.trim())
    }
    if (row.length > 0) rows.push(row)
  }

  // 表头颜色优先用主题 accent1，降级默认
  const headerFill = themeColors.get('accent1') || '#1A5276'
  const altRowFill = themeColors.get('lt2') || '#EBF5FB'

  return {
    type: 'table',
    x,
    y,
    w,
    h,
    rows: rows.length > 0 ? rows : [['']],
    headerRow: true,
    style: {
      headerFill,
      altRowFill,
      textColor: '#333333',
      borderColor: '#D0D0D0',
    },
  }
}

// ============================================
// 颜色/填充工具
// ============================================

function extractFill(parent: Element, themeColors: Map<string, string>): string | undefined {
  const solidFill = parent.getElementsByTagNameNS(NS.a, 'solidFill')[0]
  if (!solidFill) return undefined
  return extractColorFromElement(solidFill, themeColors)
}

function extractLineWidth(ln: Element): number | undefined {
  const w = ln.getAttribute('w')
  if (!w) return undefined
  const emu = parseInt(w, 10)
  if (emu <= 0) return undefined
  return emu / 12700
}
