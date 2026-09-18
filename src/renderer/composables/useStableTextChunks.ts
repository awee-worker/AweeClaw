import { useRef } from 'react'

/** 单块目标长度（字符）：块越小尾部活动区域越窄，但节点数越多 */
const DEFAULT_CHUNK_SIZE = 1200

interface ChunkCache {
  /** 上一次入参的完整文本，用于判定本次是否为「尾部追加」 */
  text: string
  /** 与 text 对应的分块结果 */
  chunks: string[]
}

/**
 * 把持续追加的长文本切成固定边界的块，并复用已定型块的字符串引用
 *
 * 流式文本每推进一次都会产生一个新的完整字符串。若整段交给单个文本节点渲染，
 * 浏览器每帧都要重新布局整段文本，代价随已输出长度增长 —— 段落越长，单帧越容易
 * 占满主线程，观感上就是内容一段一段地跳。
 *
 * 这里按固定长度切块：除最后一块外，其余块的内容在追加过程中保持不变。
 * 复用它们的字符串引用可以命中 React.memo 的浅比较短路，于是每帧只有尾部一块
 * 真正重写 DOM 文本，布局代价从「整段长度」降为「单块长度」。
 *
 * 仅适用于「只追加」的文本；检测到非追加式变更（替换、回退）时整体重建。
 */
export function useStableTextChunks(
  text: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): string[] {
  const cacheRef = useRef<ChunkCache>({ text: '', chunks: [] })
  const cache = cacheRef.current

  // 文本未变化（例如插值器暂停推进）时直接返回同一数组，连带子组件一起短路
  if (cache.text === text) return cache.chunks

  const previousText = cache.text
  const isTailAppend =
    text.length >= previousText.length &&
    (previousText.length === 0 || text.startsWith(previousText))

  const chunks: string[] = []
  const fullBlockCount = Math.floor(text.length / chunkSize)

  for (let i = 0; i < fullBlockCount; i++) {
    const start = i * chunkSize
    const end = start + chunkSize
    const previous = cache.chunks[i]

    // 该块在上一轮就已完整，且本次是尾部追加时，内容必然未变，复用原引用
    if (isTailAppend && previous !== undefined && end <= previousText.length) {
      chunks.push(previous)
    } else {
      chunks.push(text.slice(start, end))
    }
  }

  const tail = text.slice(fullBlockCount * chunkSize)
  if (tail) chunks.push(tail)

  cache.text = text
  cache.chunks = chunks

  return chunks
}
