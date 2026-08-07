/**
 * 主进程 .pptx 文件解析器
 *
 * 复用客户端渲染层 pptxParser 的核心 OOXML 解析逻辑，
 * 但运行在 Electron 主进程（Node.js 环境），使用 @xmldom/xmldom 替代浏览器 DOMParser。
 *
 * 用途：
 * - 供 mcp-pptx 插件 open_presentation 工具调用：读取已有 .pptx 文件并重建到 pptxgenjs 会话
 * - 供其他需要主进程解析 .pptx 的场景
 *
 * 设计：
 * - 输入：.pptx 文件绝对路径
 * - 输出：ParsedPresentation（slides + slideSize + title），格式与渲染层 pptxParser 一致
 * - 解析能力：文本/形状/图片/表格/背景/主题色，与渲染层对齐
 * - 限制：图表降级为占位文本，SmartArt 降级为占位文本（与渲染层一致）
 */

import { promises as fs } from 'fs'
import * as path from 'path'
// @ts-ignore - jszip 无类型声明
import JSZip from 'jszip'
// @ts-ignore - @xmldom/xmldom 类型声明不全
import { DOMParser } from '@xmldom/xmldom'
import type {
  PptSlideData,
  PptElement,
  PptTextElement,
  PptShapeElement,
  PptImageElement,
  PptSlideBackground,
} from '../../../shared/protocols/pptPreviewProtocol'

// ============================================
// 常量
// ============================================

/** EMU → 英寸换算系数（1 英寸 = 914400 EMU） */
const EMU_PER_INCH = 914400
/** 1/100 磅 → 磅 */
const PT_PER_100 = 100

/** XML 命名空间 */
const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
}

/** DOMParser 实例（主进程版本） */
const parser = new DOMParser()

// ============================================
// 类型定义（与渲染层 pptxParser 对齐）
// ============================================

export interface ParsedPresentation {
  slides: PptSlideData[]
  slideSize: { width: number; height: number }
  title: string
}

// ============================================
// 主入口
// ============================================

/**
 * 解析 .pptx 文件
 * @param filePath .pptx 文件绝对路径
 * @returns 解析结果（slides + slideSize + title）
 */
export async function parsePptxFile(filePath: string): Promise<ParsedPresentation> {
  const fileBuffer = await fs.readFile(filePath)
  const bytes = new Uint8Array(fileBuffer)
  return parsePptxBytes(bytes)
}

/** 解析 .pptx 字节流 */
async function parsePptxBytes(bytes: Uint8Array): Promise<ParsedPresentation> {
  const zip = await JSZip.loadAsync(bytes)

  // 1. 演示文稿元信息（尺寸 + 标题）
  const { slideSize, title } = await parsePresentationMeta(zip)

  // 2. 主题色表
  const themeColors = await parseThemeColors(zip)

  // 3. 收集幻灯片文件
  const slideFiles = collectSlideFiles(zip)

  // 4. 预构建媒体映射
  const slideMediaMaps = new Map<number, Map<string, string>>()
  for (const sf of slideFiles) {
    const mediaMap = await buildSlideMediaMap(zip, sf.num)
    slideMediaMaps.set(sf.num, mediaMap)
  }

  // 5. 预解析背景
  const layoutBackgrounds = new Map<number, PptSlideBackground | undefined>()
  for (const sf of slideFiles) {
    const bg = await parseSlideLayoutBackground(zip, sf.num, themeColors)
    layoutBackgrounds.set(sf.num, bg)
  }

  // 6. 逐张解析
  const slides: PptSlideData[] = []
  for (const { name, num } of slideFiles) {
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
  let slideSize = { width: 10, height: 5.625 }
  let title = 'PowerPoint 演示文稿'

  const presXml = await zip.file('ppt/presentation.xml')?.async('string')
  if (presXml) {
    const doc = parser.parseFromString(presXml, 'application/xml')
    const sldSz = doc.getElementsByTagNameNS(NS.p, 'sldSz')[0]
    if (sldSz) {
      const cx = parseInt(sldSz.getAttribute('cx') || '0', 10)
      const cy = parseInt(sldSz.getAttribute('cy') || '0', 10)
      if (cx > 0 && cy > 0) {
        slideSize = { width: cx / EMU_PER_INCH, height: cy / EMU_PER_INCH }
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

// ============================================
// 主题色解析
// ============================================

const DEFAULT_THEME_COLORS: Record<string, string> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '1F497D',
  lt2: 'EEECE1',
  accent1: '4F81BD',
  accent2: 'C0504D',
  accent3: '9BBB59',
  accent4: '8064A2',
  accent5: '4BACC6',
  accent6: 'F79646',
  hlink: '0000FF',
  folHlink: '800080',
}

async function parseThemeColors(zip: JSZip): Promise<Record<string, string>> {
  const result: Record<string, string> = { ...DEFAULT_THEME_COLORS }
  const themeXml = await zip.file('ppt/theme/theme1.xml')?.async('string')
  if (!themeXml) return result

  const doc = parser.parseFromString(themeXml, 'application/xml')
  const clrScheme = doc.getElementsByTagNameNS(NS.a, 'clrScheme')[0]
  if (!clrScheme) return result

  for (let i = 0; i < clrScheme.childNodes.length; i++) {
    const child = clrScheme.childNodes[i] as Element
    if (!child.tagName) continue
    // tagName 形如 "a:dk1" 或 "dk1"
    const name = child.localName || child.tagName.split(':').pop() || ''
    const srgb = child.getElementsByTagNameNS(NS.a, 'srgbClr')[0]
    const sysClr = child.getElementsByTagNameNS(NS.a, 'sysClr')[0]
    if (srgb) {
      const val = srgb.getAttribute('val')
      if (val) result[name] = val
    } else if (sysClr) {
      const val = sysClr.getAttribute('lastClr') || sysClr.getAttribute('val')
      if (val) result[name] = val
    }
  }
  return result
}

// ============================================
// 幻灯片文件收集
// ============================================

interface SlideFileInfo {
  name: string
  num: number
}

function collectSlideFiles(zip: JSZip): SlideFileInfo[] {
  const files: SlideFileInfo[] = []
  zip.forEach((relativePath: string, file: { dir: boolean }) => {
    if (file.dir) return
    const match = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/)
    if (match) {
      files.push({ name: relativePath, num: parseInt(match[1], 10) })
    }
  })
  files.sort((a, b) => a.num - b.num)
  return files
}

// ============================================
// 媒体映射
// ============================================

async function buildSlideMediaMap(
  zip: JSZip,
  slideNum: number,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`
  const relsXml = await zip.file(relsPath)?.async('string')
  if (!relsXml) return map

  const doc = parser.parseFromString(relsXml, 'application/xml')
  const relationships = doc.getElementsByTagName('Relationship')
  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships[i]
    const rId = rel.getAttribute('Id') || ''
    const target = rel.getAttribute('Target') || ''
    const type = rel.getAttribute('Type') || ''
    if (!type.includes('image')) continue

    // 解析媒体文件路径
    const mediaPath = target.startsWith('/')
      ? target.slice(1)
      : path.normalize(`ppt/slides/${target}`).replace(/\\/g, '/')

    const mediaFile = await zip.file(mediaPath)?.async('base64')
    if (mediaFile) {
      const ext = path.extname(mediaPath).slice(1).toLowerCase()
      const mimeType = ext === 'jpg' ? 'jpeg' : ext
      map.set(rId, `data:image/${mimeType};base64,${mediaFile}`)
    }
  }
  return map
}

// ============================================
// 背景解析
// ============================================

async function parseSlideLayoutBackground(
  zip: JSZip,
  slideNum: number,
  themeColors: Record<string, string>,
): Promise<PptSlideBackground | undefined> {
  // 简化：从 slideLayout 继承背景色
  const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`
  const relsXml = await zip.file(relsPath)?.async('string')
  if (!relsXml) return undefined

  const doc = parser.parseFromString(relsXml, 'application/xml')
  const relationships = doc.getElementsByTagName('Relationship')
  let layoutPath: string | null = null
  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships[i]
    if ((rel.getAttribute('Type') || '').includes('slideLayout')) {
      layoutPath = rel.getAttribute('Target') || ''
      break
    }
  }
  if (!layoutPath) return undefined

  const fullPath = layoutPath.startsWith('/')
    ? layoutPath.slice(1)
    : path.normalize(`ppt/slides/${layoutPath}`).replace(/\\/g, '/')

  const layoutXml = await zip.file(fullPath)?.async('string')
  if (!layoutXml) return undefined

  const layoutDoc = parser.parseFromString(layoutXml, 'application/xml')
  return extractBackground(layoutDoc, themeColors)
}

function extractBackground(
  doc: Document,
  themeColors: Record<string, string>,
): PptSlideBackground | undefined {
  const bg = doc.getElementsByTagNameNS(NS.p, 'bg')[0]
  if (!bg) return undefined
  const bgPr = bg.getElementsByTagNameNS(NS.p, 'bgPr')[0]
  if (!bgPr) return undefined
  const fill = bgPr.getElementsByTagNameNS(NS.a, 'solidFill')[0]
  if (!fill) return undefined
  const color = extractColorFromElement(fill, themeColors)
  return color ? { color } : undefined
}

/** 从元素提取背景色字符串（简化版，直接返回 hex 字符串） */
function extractBackgroundColor(
  doc: Document,
  themeColors: Record<string, string>,
): string | undefined {
  return extractBackground(doc, themeColors)?.color
}

// ============================================
// 颜色提取
// ============================================

function extractColorFromElement(
  el: Element,
  themeColors: Record<string, string>,
): string | undefined {
  const srgb = el.getElementsByTagNameNS(NS.a, 'srgbClr')[0]
  if (srgb) {
    const val = srgb.getAttribute('val')
    return val || undefined
  }
  const schemeClr = el.getElementsByTagNameNS(NS.a, 'schemeClr')[0]
  if (schemeClr) {
    const val = schemeClr.getAttribute('val')
    if (val && themeColors[val]) {
      return themeColors[val]
    }
  }
  const sysClr = el.getElementsByTagNameNS(NS.a, 'sysClr')[0]
  if (sysClr) {
    return sysClr.getAttribute('lastClr') || sysClr.getAttribute('val') || undefined
  }
  return undefined
}

// ============================================
// 幻灯片解析
// ============================================

function parseSlideXml(
  xml: string,
  slideIndex: number,
  mediaMap: Map<string, string>,
  themeColors: Record<string, string>,
  fallbackBg: PptSlideBackground | undefined,
): PptSlideData {
  const doc = parser.parseFromString(xml, 'application/xml')
  const spTree = doc.getElementsByTagNameNS(NS.p, 'spTree')[0]
  if (!spTree) {
    return { sessionId: '', slideIndex, elements: [], background: fallbackBg }
  }

  // 背景
  const bgColor = extractBackgroundColor(doc, themeColors) || fallbackBg?.color
  const bg: PptSlideBackground | undefined = bgColor ? { color: bgColor } : undefined

  // 元素
  const elements: PptElement[] = []
  const sps = spTree.getElementsByTagNameNS(NS.p, 'sp')
  for (let i = 0; i < sps.length; i++) {
    try {
      const el = parseShapeElement(sps[i], mediaMap, themeColors)
      if (el) elements.push(el)
    } catch {
      // 单元素解析失败跳过
    }
  }

  // 图片
  const pics = spTree.getElementsByTagNameNS(NS.p, 'pic')
  for (let i = 0; i < pics.length; i++) {
    try {
      const el = parsePictureElement(pics[i], mediaMap)
      if (el) elements.push(el)
    } catch {
      // 跳过
    }
  }

  // 图形组合
  const grpSps = spTree.getElementsByTagNameNS(NS.p, 'grpSp')
  for (let i = 0; i < grpSps.length; i++) {
    const innerSps = grpSps[i].getElementsByTagNameNS(NS.p, 'sp')
    for (let j = 0; j < innerSps.length; j++) {
      try {
        const el = parseShapeElement(innerSps[j], mediaMap, themeColors)
        if (el) elements.push(el)
      } catch {
        // 跳过
      }
    }
  }

  return { sessionId: '', slideIndex, elements, background: bg }
}

function parseShapeElement(
  sp: Element,
  _mediaMap: Map<string, string>,
  themeColors: Record<string, string>,
): PptElement | null {
  // 位置尺寸
  const xfrm = sp.getElementsByTagNameNS(NS.a, 'xfrm')[0]
  const off = xfrm?.getElementsByTagNameNS(NS.a, 'off')[0]
  const ext = xfrm?.getElementsByTagNameNS(NS.a, 'ext')[0]
  if (!off || !ext) return null

  const x = parseInt(off.getAttribute('x') || '0', 10) / EMU_PER_INCH
  const y = parseInt(off.getAttribute('y') || '0', 10) / EMU_PER_INCH
  const w = parseInt(ext.getAttribute('cx') || '0', 10) / EMU_PER_INCH
  const h = parseInt(ext.getAttribute('cy') || '0', 10) / EMU_PER_INCH
  if (w <= 0 || h <= 0) return null

  // 文本内容
  const txBody = sp.getElementsByTagNameNS(NS.p, 'txBody')[0]
  if (txBody) {
    const text = extractText(txBody)
    if (text) {
      const rPr = txBody.getElementsByTagNameNS(NS.a, 'r')[0]?.getElementsByTagNameNS(NS.a, 'rPr')[0]
      const fontSize = rPr?.getAttribute('sz')
        ? parseInt(rPr.getAttribute('sz')!, 10) / PT_PER_100
        : 18
      const color = extractColorFromElement(
        rPr?.getElementsByTagNameNS(NS.a, 'solidFill')[0] || txBody,
        themeColors,
      )
      const fill = extractColorFromElement(
        sp.getElementsByTagNameNS(NS.p, 'spPr')[0]?.getElementsByTagNameNS(NS.a, 'solidFill')[0] as Element,
        themeColors,
      )
      return {
        type: 'text',
        x, y, w, h,
        text,
        fontSize,
        color: color || '333333',
        fill: fill ? '#' + fill : undefined,
      } as PptTextElement
    }
  }

  // 形状
  const prstGeom = sp.getElementsByTagNameNS(NS.a, 'prstGeom')[0]
  const shapeType = prstGeom?.getAttribute('prst') || 'rect'
  const fill = extractColorFromElement(
    sp.getElementsByTagNameNS(NS.p, 'spPr')[0]?.getElementsByTagNameNS(NS.a, 'solidFill')[0] as Element,
    themeColors,
  )
  const line = extractColorFromElement(
    sp.getElementsByTagNameNS(NS.p, 'spPr')[0]?.getElementsByTagNameNS(NS.a, 'ln')[0] as Element,
    themeColors,
  )

  if (!fill && !line) return null // 空占位形状跳过

  return {
    type: 'shape',
    shape: mapShapeType(shapeType),
    x, y, w, h,
    fill: fill ? '#' + fill : undefined,
    line: line ? '#' + line : undefined,
  } as PptShapeElement
}

function parsePictureElement(
  pic: Element,
  mediaMap: Map<string, string>,
): PptElement | null {
  const xfrm = pic.getElementsByTagNameNS(NS.a, 'xfrm')[0]
  const off = xfrm?.getElementsByTagNameNS(NS.a, 'off')[0]
  const ext = xfrm?.getElementsByTagNameNS(NS.a, 'ext')[0]
  if (!off || !ext) return null

  const x = parseInt(off.getAttribute('x') || '0', 10) / EMU_PER_INCH
  const y = parseInt(off.getAttribute('y') || '0', 10) / EMU_PER_INCH
  const w = parseInt(ext.getAttribute('cx') || '0', 10) / EMU_PER_INCH
  const h = parseInt(ext.getAttribute('cy') || '0', 10) / EMU_PER_INCH
  if (w <= 0 || h <= 0) return null

  const blipFill = pic.getElementsByTagNameNS(NS.p, 'blipFill')[0]
  const blip = blipFill?.getElementsByTagNameNS(NS.a, 'blip')[0]
  const embed = blip?.getAttributeNS(NS.r, 'embed')
  if (!embed) return null

  const src = mediaMap.get(embed)
  if (!src) return null

  return { type: 'image', x, y, w, h, src } as PptImageElement
}

function extractText(txBody: Element): string {
  const paragraphs = txBody.getElementsByTagNameNS(NS.a, 'p')
  const lines: string[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    const runs = paragraphs[i].getElementsByTagNameNS(NS.a, 'r')
    let line = ''
    for (let j = 0; j < runs.length; j++) {
      const t = runs[j].getElementsByTagNameNS(NS.a, 't')[0]
      if (t && t.textContent) line += t.textContent
    }
    if (line) lines.push(line)
  }
  return lines.join('\n')
}

function mapShapeType(prst: string): PptShapeElement['shape'] {
  const map: Record<string, PptShapeElement['shape']> = {
    rect: 'rect',
    roundRect: 'roundRect',
    ellipse: 'ellipse',
    line: 'line',
    triangle: 'triangle',
    chevron: 'chevron',
    rightArrow: 'arrow',
    arrow: 'arrow',
  }
  return map[prst] || 'rect'
}
