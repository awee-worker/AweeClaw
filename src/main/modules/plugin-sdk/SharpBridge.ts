/**
 * Sharp 图像处理桥接层
 *
 * 封装 sharp 库，为插件提供统一的图像处理能力：
 * - resize / crop / rotate / filter / watermark / convert / info
 *
 * 所有方法接受 Buffer 输入，返回 Buffer 或元信息对象。
 * 插件通过 globalThis.__AWEECLAW_HOST__.sharp.* 调用。
 *
 * @module plugin-sdk/SharpBridge
 */

import sharp from 'sharp'
import { logger } from '@shared/toolkit/LogEngine'

/** Resize 选项 */
export interface ResizeOptions {
  width?: number
  height?: number
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
  withoutEnlargement?: boolean
}

/** Crop 选项 */
export interface CropOptions {
  left: number
  top: number
  width: number
  height: number
}

/** Rotate 选项 */
export interface RotateOptions {
  angle: number
  background?: string
}

/** Filter 选项 */
export interface FilterOptions {
  type: 'grayscale' | 'sepia' | 'invert' | 'blur' | 'sharpen' | 'negate'
  intensity?: number
}

/** Watermark 选项 */
export interface WatermarkOptions {
  text: string
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'tile'
  opacity?: number
  fontSize?: number
  color?: string
}

/** Convert 选项 */
export interface ConvertOptions {
  format: 'png' | 'jpg' | 'jpeg' | 'webp' | 'avif'
  quality?: number
  progressive?: boolean
  palette?: boolean
}

/** 图像元信息 */
export interface ImageInfo {
  format: string
  width: number
  height: number
  hasAlpha: boolean
  space: string
  channels: number
  density?: number
}

/**
 * Sharp 桥接服务
 *
 * 单例模式，懒加载 sharp 实例。
 * 所有方法均为异步，返回新 Buffer（不修改输入）。
 */
class SharpBridgeService {
  private initialized = false

  /**
   * 初始化（懒加载，首次调用时触发）
   */
  private ensureInit(): void {
    if (this.initialized) return
    // sharp 在首次 import 时会加载 native binding，
    // 这里仅做标记，实际使用时才创建 pipeline
    this.initialized = true
    logger.system?.info('[SharpBridge] sharp bridge initialized')
  }

  /**
   * 缩放图像
   */
  async resize(input: Buffer, opts: ResizeOptions): Promise<Buffer> {
    this.ensureInit()
    let pipeline = sharp(input).resize({
      width: opts.width,
      height: opts.height,
      fit: opts.fit || 'cover',
      withoutEnlargement: opts.withoutEnlargement ?? true,
    })
    // 保持原格式
    const meta = await sharp(input).metadata()
    pipeline = this.applyFormat(pipeline, meta.format || 'png', 90)
    return pipeline.toBuffer()
  }

  /**
   * 裁剪图像
   */
  async crop(input: Buffer, opts: CropOptions): Promise<Buffer> {
    this.ensureInit()
    const meta = await sharp(input).metadata()
    // 边界校验
    const left = Math.max(0, Math.min(opts.left, meta.width!))
    const top = Math.max(0, Math.min(opts.top, meta.height!))
    const width = Math.max(1, Math.min(opts.width, meta.width! - left))
    const height = Math.max(1, Math.min(opts.height, meta.height! - top))

    let pipeline = sharp(input).extract({ left, top, width, height })
    pipeline = this.applyFormat(pipeline, meta.format || 'png', 90)
    return pipeline.toBuffer()
  }

  /**
   * 旋转图像
   */
  async rotate(input: Buffer, opts: RotateOptions): Promise<Buffer> {
    this.ensureInit()
    const meta = await sharp(input).metadata()
    let pipeline = sharp(input).rotate(opts.angle, {
      background: opts.background || '#000000',
    })
    pipeline = this.applyFormat(pipeline, meta.format || 'png', 90)
    return pipeline.toBuffer()
  }

  /**
   * 应用滤镜
   */
  async filter(input: Buffer, opts: FilterOptions): Promise<Buffer> {
    this.ensureInit()
    const meta = await sharp(input).metadata()
    let pipeline = sharp(input)

    switch (opts.type) {
      case 'grayscale':
        pipeline = pipeline.grayscale()
        break
      case 'sepia':
        // sharp 无内置 sepia，通过 recomb 矩阵实现
        pipeline = pipeline.recomb([
          [0.393, 0.769, 0.189],
          [0.349, 0.686, 0.168],
          [0.272, 0.534, 0.131],
        ])
        break
      case 'invert':
      case 'negate':
        pipeline = pipeline.negate()
        break
      case 'blur':
        pipeline = pipeline.blur(opts.intensity ?? 5)
        break
      case 'sharpen':
        pipeline = pipeline.sharpen({ sigma: opts.intensity ?? 1 })
        break
      default:
        throw new Error(`Unsupported filter: ${opts.type}`)
    }

    pipeline = this.applyFormat(pipeline, meta.format || 'png', 90)
    return pipeline.toBuffer()
  }

  /**
   * 添加文字水印
   *
   * 使用 SVG 叠加方式实现，兼容所有格式。
   */
  async watermark(input: Buffer, opts: WatermarkOptions): Promise<Buffer> {
    this.ensureInit()
    const meta = await sharp(input).metadata()
    const w = meta.width!
    const h = meta.height!
    const fontSize = opts.fontSize ?? 48
    const opacity = opts.opacity ?? 0.5
    const color = opts.color || '#ffffff'
    const text = String(opts.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    // 计算水印位置
    const padding = 20
    const positions: Record<string, { x: number; y: number; anchor: string }> = {
      'top-left': { x: padding, y: padding + fontSize, anchor: 'start' },
      'top-right': { x: w - padding, y: padding + fontSize, anchor: 'end' },
      'bottom-left': { x: padding, y: h - padding, anchor: 'start' },
      'bottom-right': { x: w - padding, y: h - padding, anchor: 'end' },
      center: { x: w / 2, y: h / 2 + fontSize / 2, anchor: 'middle' },
    }

    // 构建 SVG 水印层
    let svg: string
    if (opts.position === 'tile') {
      // 平铺水印
      const stepX = Math.max(w / 4, 150)
      const stepY = Math.max(h / 4, 80)
      const texts: string[] = []
      for (let y = stepY; y < h; y += stepY) {
        for (let x = stepX; x < w; x += stepX) {
          texts.push(
            `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${color}" fill-opacity="${opacity}" text-anchor="middle" font-family="sans-serif" transform="rotate(-30 ${x} ${y})">${text}</text>`,
          )
        }
      }
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${texts.join('')}</svg>`
    } else {
      const pos = positions[opts.position || 'bottom-right'] || positions['bottom-right']
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="${pos.x}" y="${pos.y}" font-size="${fontSize}" fill="${color}" fill-opacity="${opacity}" text-anchor="${pos.anchor}" font-family="sans-serif">${text}</text></svg>`
    }

    const svgBuffer = Buffer.from(svg, 'utf-8')
    let pipeline = sharp(input).composite([{ input: svgBuffer, blend: 'over' }])
    pipeline = this.applyFormat(pipeline, meta.format || 'png', 90)
    return pipeline.toBuffer()
  }

  /**
   * 格式转换
   */
  async convert(input: Buffer, opts: ConvertOptions): Promise<Buffer> {
    this.ensureInit()
    const quality = opts.quality ?? 85
    let pipeline = sharp(input)
    pipeline = this.applyFormat(pipeline, opts.format, quality, opts.progressive, opts.palette)
    return pipeline.toBuffer()
  }

  /**
   * 获取图像元信息
   */
  async info(input: Buffer): Promise<ImageInfo> {
    this.ensureInit()
    const meta = await sharp(input).metadata()
    return {
      format: meta.format || 'unknown',
      width: meta.width || 0,
      height: meta.height || 0,
      hasAlpha: meta.hasAlpha ?? false,
      space: meta.space || 'unknown',
      channels: meta.channels || 0,
      density: meta.density,
    }
  }

  /**
   * 根据目标格式应用 sharp 转换选项
   */
  private applyFormat(
    pipeline: sharp.Sharp,
    format: string,
    quality: number,
    progressive?: boolean,
    palette?: boolean,
  ): sharp.Sharp {
    switch (format) {
      case 'jpeg':
      case 'jpg':
        return pipeline.jpeg({ quality, progressive: progressive ?? true, mozjpeg: true })
      case 'png':
        return pipeline.png({
          quality,
          progressive: progressive ?? true,
          palette: palette ?? false,
          compressionLevel: 9,
        })
      case 'webp':
        return pipeline.webp({ quality, alphaQuality: 90 })
      case 'avif':
        return pipeline.avif({ quality, chromaSubsampling: '4:2:0' })
      case 'tiff':
        return pipeline.tiff({ quality })
      default:
        return pipeline.png({ quality, compressionLevel: 9 })
    }
  }
}

/** 单例 */
export const sharpBridge = new SharpBridgeService()
