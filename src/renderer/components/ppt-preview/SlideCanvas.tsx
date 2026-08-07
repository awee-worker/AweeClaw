/**
 * SlideCanvas - 幻灯片画布渲染组件
 *
 * 根据幻灯片 JSON 数据渲染所有元素（文本/形状/图片/图表/表格）。
 * 将英寸坐标按比例缩放到画布像素尺寸。
 *
 * 用于两种场景：
 * 1. 大图预览（width=720）
 * 2. 缩略图（width=140）
 *
 * 实现要点：
 * - 所有形状尺寸先按 scale 转为像素数值再注入 style，避免 string/number 类型混淆
 * - 图表用 SVG 渲染，避免引入第三方图表库的体积开销
 * - 颜色统一使用十六进制（与 pptxgenjs 输出一致）
 */

import { memo, useMemo } from 'react'
import type {
  PptSlideData,
  PptElement,
  PptTextElement,
  PptShapeElement,
  PptImageElement,
  PptChartElement,
  PptTableElement,
} from '@shared/protocols/pptPreviewProtocol'

/** 默认幻灯片尺寸（英寸，16:9 10×5.625）。
 *  实际尺寸通过 slideSize prop 注入，此值仅作兜底。 */
const DEFAULT_SLIDE_W_IN = 10
const DEFAULT_SLIDE_H_IN = 5.625

/** 磅→英寸换算常数（1 英寸 = 72 磅）。
 *  pptxgenjs / OOXML 中 fontSize 单位为磅（points），
 *  需先除以 72 转为英寸，再乘 scale 转为像素。 */
const PT_TO_PX_FACTOR = 1 / 72

/** 图表默认配色 */
const CHART_COLORS = ['#4A90D9', '#E94B3C', '#F5A623', '#7ED321', '#9013FE', '#50E3C2']

interface SlideCanvasProps {
  slide: PptSlideData
  /** 画布宽度（像素） */
  width: number
  /** 是否显示元素边框（调试用） */
  showBorder?: boolean
  /** 幻灯片实际尺寸（英寸）。
   *  不同 PPT 文件尺寸不同（10×5.625 / 13.33×7.5 / 自定义），
   *  必须传入实际尺寸才能正确缩放坐标，否则内容会被压缩或裁剪。 */
  slideSize?: { width: number; height: number }
}

function SlideCanvasImpl({ slide, width, slideSize }: SlideCanvasProps) {
  // 实际幻灯片尺寸（英寸），未提供时用默认 16:9
  const slideWIn = slideSize?.width || DEFAULT_SLIDE_W_IN
  const slideHIn = slideSize?.height || DEFAULT_SLIDE_H_IN

  // 缩放比例：像素/英寸
  const scale = width / slideWIn
  const height = slideHIn * scale

  // 背景样式
  const bgStyle = useMemo<React.CSSProperties>(() => {
    if (slide.background?.image) {
      return {
        backgroundImage: `url(${slide.background.image})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    return { backgroundColor: slide.background?.color || '#ffffff' }
  }, [slide.background])

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width,
        height,
        ...bgStyle,
        borderRadius: Math.max(2, scale * 0.5),
      }}
    >
      {slide.elements.map((el, i) => (
        <ElementRenderer key={i} element={el} scale={scale} />
      ))}
    </div>
  )
}

export const SlideCanvas = memo(SlideCanvasImpl)

// ============================================
// 元素分发
// ============================================

/** 计算元素绝对像素位置（共享 baseStyle 的数值版本，便于形状内部派生计算） */
interface ElementBox {
  x: number
  y: number
  w: number
  h: number
}

function getBox(element: PptElement): ElementBox {
  return { x: element.x, y: element.y, w: element.w, h: element.h }
}

function ElementRenderer({ element, scale }: { element: PptElement; scale: number }) {
  const box = getBox(element)
  // 像素数值，避免 string|number 联合类型污染下游样式
  const px = {
    left: box.x * scale,
    top: box.y * scale,
    width: box.w * scale,
    height: box.h * scale,
  }
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: px.left,
    top: px.top,
    width: px.width,
    height: px.height,
  }

  switch (element.type) {
    case 'text':
      return <TextElementView el={element} baseStyle={baseStyle} scale={scale} />
    case 'shape':
      return <ShapeElementView el={element} baseStyle={baseStyle} px={px} />
    case 'image':
      return <ImageElementView el={element} baseStyle={baseStyle} />
    case 'chart':
      return <ChartElementView el={element} baseStyle={baseStyle} scale={scale} px={px} />
    case 'table':
      return <TableElementView el={element} baseStyle={baseStyle} scale={scale} />
    default:
      return null
  }
}

// --------------------------------------------
// 文本元素
// --------------------------------------------
function TextElementView({
  el,
  baseStyle,
  scale,
}: {
  el: PptTextElement
  baseStyle: React.CSSProperties
  scale: number
}) {
  return (
    <div
      style={{
        ...baseStyle,
        display: 'flex',
        flexDirection: 'column',
        justifyContent:
          el.valign === 'middle' ? 'center' : el.valign === 'bottom' ? 'flex-end' : 'flex-start',
        alignItems:
          el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
        backgroundColor: el.fill || 'transparent',
        padding: scale * 0.1,
        // 文字超出文本框时仍可见（更接近真实 PPT 渲染，避免内容被裁剪）
        overflow: 'visible',
      }}
    >
      {el.text.split('\n').map((line, i) => (
        <span
          key={i}
          style={{
            // 等比例缩放：pt / 72 * scale。
            // 缩略图字号会很小（如 2-3px），这是正确的——缩略图只需展示布局比例。
            // 不再钳制最小值，否则缩略图字号失真导致内容错乱。
            fontSize: el.fontSize * scale * PT_TO_PX_FACTOR * 0.96,
            color: el.color,
            fontWeight: el.bold ? 'bold' : 'normal',
            fontStyle: el.italic ? 'italic' : 'normal',
            textAlign: el.align || 'left',
            lineHeight: 1.3,
            width: '100%',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
          }}
        >
          {line || '\u00A0'}
        </span>
      ))}
    </div>
  )
}

// --------------------------------------------
// 形状元素
// --------------------------------------------
interface PixelBox {
  left: number
  top: number
  width: number
  height: number
}

function ShapeElementView({
  el,
  baseStyle,
  px,
}: {
  el: PptShapeElement
  baseStyle: React.CSSProperties
  px: PixelBox
}) {
  // 公共边框宽度（磅 → 像素近似，1pt ≈ 1.333px @96dpi；这里直接用磅值*scale/72*96 略繁，简化为 max(1, lineWidth)px）
  const borderWidth = Math.max(1, el.lineWidth || 1)
  const fillColor = el.fill || 'transparent'
  const lineColor = el.line || 'transparent'
  const rotate = el.rotate ? `rotate(${el.rotate}deg)` : undefined

  // 矩形类（rect / roundRect / ellipse）
  if (el.shape === 'rect' || el.shape === 'roundRect' || el.shape === 'ellipse') {
    const borderRadius =
      el.shape === 'ellipse' ? '50%' : el.shape === 'roundRect' ? `${px.width * 0.12}px` : '0'
    return (
      <div
        style={{
          ...baseStyle,
          backgroundColor: fillColor,
          border: el.line ? `${borderWidth}px solid ${lineColor}` : 'none',
          borderRadius,
          transform: rotate,
        }}
      />
    )
  }

  // 直线：以元素左上为起点，沿宽度方向画一条水平线（高度即线宽）
  // pptxgenjs 的 line 类型是 { type:'line', x, y, w, h }，w 为水平长度，h 通常为 0
  if (el.shape === 'line') {
    const lineThickness = Math.max(1, el.lineWidth || 1)
    return (
      <div
        style={{
          position: 'absolute',
          left: px.left,
          top: px.top + (px.height - lineThickness) / 2,
          width: px.width,
          height: lineThickness,
          backgroundColor: el.line || el.fill || '#000000',
          transform: rotate,
        }}
      />
    )
  }

  // 三角形（向上）：用 border-trick 实现
  if (el.shape === 'triangle') {
    const w = px.width
    const h = px.height
    return (
      <div
        style={{
          position: 'absolute',
          left: px.left,
          top: px.top,
          width: 0,
          height: 0,
          borderLeft: `${w / 2}px solid transparent`,
          borderRight: `${w / 2}px solid transparent`,
          borderBottom: `${h}px solid ${fillColor === 'transparent' ? lineColor : fillColor}`,
          transform: rotate,
        }}
      />
    )
  }

  // 箭头 / chevron：矩形 + 右侧三角凸出
  if (el.shape === 'arrow' || el.shape === 'chevron') {
    const h = px.height
    const arrowDepth = Math.min(h * 0.3, px.width * 0.2)
    return (
      <div
        style={{
          ...baseStyle,
          backgroundColor: fillColor,
          border: el.line ? `${borderWidth}px solid ${lineColor}` : 'none',
          transform: rotate,
          clipPath: `polygon(0 0, ${px.width - arrowDepth}px 0, ${px.width}px 50%, ${px.width - arrowDepth}px 100%, 0 100%)`,
        }}
      />
    )
  }

  // 兜底
  return <div style={{ ...baseStyle, backgroundColor: fillColor }} />
}

// --------------------------------------------
// 图片元素
// --------------------------------------------
function ImageElementView({
  el,
  baseStyle,
}: {
  el: PptImageElement
  baseStyle: React.CSSProperties
}) {
  return (
    <img
      src={el.src}
      alt=""
      style={{
        ...baseStyle,
        objectFit: 'contain',
        transform: el.rotate ? `rotate(${el.rotate}deg)` : undefined,
      }}
      onError={(e) => {
        // 图片加载失败时显示占位灰块，避免布局塌陷
        const target = e.target as HTMLImageElement
        target.style.display = 'none'
      }}
    />
  )
}

// --------------------------------------------
// 图表元素
// --------------------------------------------
function ChartElementView({
  el,
  baseStyle,
  scale,
  px,
}: {
  el: PptChartElement
  baseStyle: React.CSSProperties
  scale: number
  px: PixelBox
}) {
  const { data, chartType, title } = el

  // 防御：空数据时显示占位
  if (!data || !data.categories?.length || !data.series?.length) {
    return (
      <div
        style={{
          ...baseStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#999',
          fontSize: 12 * scale * PT_TO_PX_FACTOR,
          backgroundColor: '#fafafa',
        }}
      >
        {title || '图表数据为空'}
      </div>
    )
  }

  const chartW = px.width
  const chartH = px.height
  const innerH = chartH * 0.8 // 留出底部 20% 给 X 轴标签
  const maxVal = Math.max(...data.series.flatMap((s) => s.values), 1)

  // 通用标题
  const titleEl = title ? (
    <div
      style={{
        fontSize: 12 * scale * PT_TO_PX_FACTOR,
        fontWeight: 'bold',
        marginBottom: 4,
        color: '#333',
      }}
    >
      {title}
    </div>
  ) : null

  // ===== 饼图 =====
  if (chartType === 'pie') {
    const series0 = data.series[0]
    const total = series0.values.reduce((a, b) => a + b, 0) || 1
    const cx = chartW / 2
    const cy = innerH / 2
    const r = Math.min(cx, cy) * 0.85
    let cumulative = 0

    return (
      <div style={{ ...baseStyle, padding: scale * 0.2, overflow: 'hidden' }}>
        {titleEl}
        <svg width={chartW} height={innerH} viewBox={`0 0 ${chartW} ${innerH}`}>
          {data.categories.map((_cat, i) => {
            const val = series0.values[i] || 0
            const startAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2
            cumulative += val
            const endAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2
            const x1 = cx + r * Math.cos(startAngle)
            const y1 = cy + r * Math.sin(startAngle)
            const x2 = cx + r * Math.cos(endAngle)
            const y2 = cy + r * Math.sin(endAngle)
            const largeArc = val / total > 0.5 ? 1 : 0
            // 占比 100% 时画整圆（path A 命令在 100% 时无法画出完整圆）
            if (val / total >= 0.9999) {
              return <circle key={i} cx={cx} cy={cy} r={r} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="#fff" strokeWidth="1" />
            }
            return (
              <path
                key={i}
                d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                stroke="#fff"
                strokeWidth="1"
              />
            )
          })}
        </svg>
      </div>
    )
  }

  // ===== 折线图 =====
  if (chartType === 'line' || chartType === 'area') {
    const stepX = chartW / (data.categories.length + 1)
    return (
      <div style={{ ...baseStyle, padding: scale * 0.2, overflow: 'hidden' }}>
        {titleEl}
        <svg width={chartW} height={innerH} viewBox={`0 0 ${chartW} ${innerH}`}>
          {data.series.map((series, si) => {
            const points = series.values
              .map((v, i) => {
                const x = (i + 1) * stepX
                const y = innerH - (v / maxVal) * innerH * 0.85
                return `${x},${y}`
              })
              .join(' ')
            const color = CHART_COLORS[si % CHART_COLORS.length]
            if (chartType === 'area') {
              const firstX = stepX
              const lastX = (series.values.length) * stepX
              return (
                <polygon
                  key={si}
                  points={`${firstX},${innerH} ${points} ${lastX},${innerH}`}
                  fill={color}
                  fillOpacity="0.3"
                  stroke={color}
                  strokeWidth="2"
                />
              )
            }
            return (
              <polyline
                key={si}
                points={points}
                fill="none"
                stroke={color}
                strokeWidth="2"
              />
            )
          })}
          {data.categories.map((cat, i) => (
            <text
              key={i}
              x={(i + 1) * stepX}
              y={innerH - 2}
              fontSize={10 * scale * PT_TO_PX_FACTOR}
              fill="#666"
              textAnchor="middle"
            >
              {cat}
            </text>
          ))}
        </svg>
      </div>
    )
  }

  // ===== 柱状图（默认） =====
  const groupW = chartW / data.categories.length
  const barW = (groupW * 0.7) / data.series.length

  return (
    <div style={{ ...baseStyle, padding: scale * 0.2, overflow: 'hidden' }}>
      {titleEl}
      <svg width={chartW} height={innerH} viewBox={`0 0 ${chartW} ${innerH}`}>
        {data.categories.map((cat, ci) => {
          const groupX = ci * groupW + groupW * 0.15
          return (
            <g key={ci}>
              {data.series.map((series, si) => {
                const val = series.values[ci] || 0
                const barH = (val / maxVal) * innerH * 0.85
                const x = groupX + si * barW
                const y = innerH - barH
                return (
                  <rect
                    key={`${ci}-${si}`}
                    x={x}
                    y={y}
                    width={barW * 0.9}
                    height={barH}
                    fill={CHART_COLORS[si % CHART_COLORS.length]}
                  />
                )
              })}
              <text
                x={groupX + (groupW * 0.7) / 2}
                y={innerH - 2}
                fontSize={10 * scale * PT_TO_PX_FACTOR}
                fill="#666"
                textAnchor="middle"
              >
                {cat}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// --------------------------------------------
// 表格元素
// --------------------------------------------
function TableElementView({
  el,
  baseStyle,
  scale,
}: {
  el: PptTableElement
  baseStyle: React.CSSProperties
  scale: number
}) {
  const { rows, headerRow, colWidths, style } = el
  const numCols = rows[0]?.length || 0
  const colW = colWidths?.length === numCols ? colWidths : Array(numCols).fill(1 / numCols)

  // v2.2：优先使用主题配色，降级到默认色
  const headerFill = style?.headerFill || '#1A5276'
  const altRowFill = style?.altRowFill || '#EBF5FB'
  const textColor = style?.textColor || '#333333'
  const borderColor = style?.borderColor || '#D0D0D0'

  return (
    <div style={{ ...baseStyle, overflow: 'hidden' }}>
      <table
        style={{
          width: '100%',
          height: '100%',
          borderCollapse: 'collapse',
          fontSize: 10 * scale * PT_TO_PX_FACTOR,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
          tableLayout: 'fixed',
        }}
      >
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    width: `${colW[ci] * 100}%`,
                    border: `1px solid ${borderColor}`,
                    padding: `${2 * scale}px ${4 * scale}px`,
                    backgroundColor:
                      headerRow && ri === 0 ? headerFill : ri % 2 === 0 ? altRowFill : '#ffffff',
                    color: headerRow && ri === 0 ? '#ffffff' : textColor,
                    fontWeight: headerRow && ri === 0 ? 'bold' : 'normal',
                    textAlign: 'left',
                    verticalAlign: 'middle',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
