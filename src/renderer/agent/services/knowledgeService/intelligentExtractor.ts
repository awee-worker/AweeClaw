import type { KnowledgeCategory } from './types'

export interface ExtractedEntry {
  title: string
  content: string
  category: KnowledgeCategory
  confidence: number
}

interface ContentBlock {
  type: 'heading' | 'paragraph' | 'list' | 'code' | 'table' | 'blank'
  level: number
  text: string
  rawText: string
}

interface SemanticGroup {
  title: string
  context: string
  blocks: ContentBlock[]
  totalLength: number
}

const MIN_ENTRY_LENGTH = 80
const MAX_ENTRY_LENGTH = 4000
const IDEAL_ENTRY_LENGTH = 2000
const MIN_HEADING_CONTENT = 60

class IntelligentExtractor {

  extract(content: string, fileName: string): ExtractedEntry[] {
    const trimmed = content.trim()
    if (trimmed.length < MIN_ENTRY_LENGTH) return []

    const blocks = this.segmentIntoBlocks(trimmed)
    if (blocks.length === 0) return []

    const groups = this.groupBySemantics(blocks)
    const validated = this.validateAndRepair(groups)
    const entries = this.buildEntries(validated, fileName)

    return entries.filter(e => this.isCompleteUnit(e))
  }

  private segmentIntoBlocks(content: string): ContentBlock[] {
    const lines = content.split('\n')
    const blocks: ContentBlock[] = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]
      const trimmedLine = line.trim()

      if (!trimmedLine) {
        i++
        continue
      }

      const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)/)
      if (headingMatch) {
        blocks.push({
          type: 'heading',
          level: headingMatch[1].length,
          text: headingMatch[2].trim(),
          rawText: line,
        })
        i++
        continue
      }

      const cnHeadingMatch = trimmedLine.match(/^(第[一二三四五六七八九十百千\d]+[章节篇部回集卷部分项])\s*(.*)/)
      if (cnHeadingMatch) {
        blocks.push({
          type: 'heading',
          level: 1,
          text: cnHeadingMatch[0].trim(),
          rawText: line,
        })
        i++
        continue
      }

      const cnSubHeadingMatch = trimmedLine.match(/^([一二三四五六七八九十]+)[、．.]\s*(.+)/)
      if (cnSubHeadingMatch) {
        blocks.push({
          type: 'heading',
          level: 2,
          text: trimmedLine,
          rawText: line,
        })
        i++
        continue
      }

      const numHeadingMatch = trimmedLine.match(/^(\d{1,2})[\.、．]\s*([^\d].{3,})/)
      if (numHeadingMatch && trimmedLine.length < 80) {
        blocks.push({
          type: 'heading',
          level: 2,
          text: trimmedLine,
          rawText: line,
        })
        i++
        continue
      }

      const subNumHeadingMatch = trimmedLine.match(/^(\d{1,2}\.\d{1,2})\s+(.+)/)
      if (subNumHeadingMatch && trimmedLine.length < 80) {
        blocks.push({
          type: 'heading',
          level: 3,
          text: trimmedLine,
          rawText: line,
        })
        i++
        continue
      }

      if (trimmedLine.startsWith('```') || trimmedLine.startsWith('~~~')) {
        const codeLines: string[] = [line]
        i++
        const fence = trimmedLine.slice(0, 3)
        while (i < lines.length) {
          codeLines.push(lines[i])
          if (lines[i].trim().startsWith(fence) && i > 0) {
            i++
            break
          }
          i++
        }
        blocks.push({
          type: 'code',
          level: 0,
          text: codeLines.join('\n'),
          rawText: codeLines.join('\n'),
        })
        continue
      }

      if (/^[-*+]\s/.test(trimmedLine) || /^\d+[.)]\s/.test(trimmedLine)) {
        const listLines: string[] = [line]
        i++
        while (i < lines.length) {
          const nextTrimmed = lines[i].trim()
          if (/^[-*+]\s/.test(nextTrimmed) || /^\d+[.)]\s/.test(nextTrimmed) || (nextTrimmed.startsWith('  ') && nextTrimmed.length > 2)) {
            listLines.push(lines[i])
            i++
          } else {
            break
          }
        }
        blocks.push({
          type: 'list',
          level: 0,
          text: listLines.join('\n'),
          rawText: listLines.join('\n'),
        })
        continue
      }

      if (trimmedLine.includes('|') && (trimmedLine.match(/\|/g) || []).length >= 2) {
        const tableLines: string[] = [line]
        i++
        while (i < lines.length) {
          const nextTrimmed = lines[i].trim()
          if (nextTrimmed.includes('|') || /^[-:| ]+$/.test(nextTrimmed)) {
            tableLines.push(lines[i])
            i++
          } else {
            break
          }
        }
        blocks.push({
          type: 'table',
          level: 0,
          text: tableLines.join('\n'),
          rawText: tableLines.join('\n'),
        })
        continue
      }

      const paraLines: string[] = [line]
      i++
      while (i < lines.length) {
        const nextTrimmed = lines[i].trim()
        if (!nextTrimmed) break
        if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|```|~~~)/.test(nextTrimmed)) break
        if (nextTrimmed.includes('|') && (nextTrimmed.match(/\|/g) || []).length >= 2) break
        paraLines.push(lines[i])
        i++
      }
      blocks.push({
        type: 'paragraph',
        level: 0,
        text: paraLines.join('\n'),
        rawText: paraLines.join('\n'),
      })
    }

    return blocks
  }

  private groupBySemantics(blocks: ContentBlock[]): SemanticGroup[] {
    if (blocks.length === 0) return []

    const groups: SemanticGroup[] = []
    const headingStack: string[] = []
    let currentGroup: SemanticGroup | null = null

    for (const block of blocks) {
      if (block.type === 'heading') {
        headingStack.length = Math.min(block.level - 1, headingStack.length)
        headingStack[block.level - 1] = block.text
        headingStack.length = block.level

        if (currentGroup && currentGroup.totalLength >= MIN_HEADING_CONTENT) {
          groups.push(currentGroup)
        } else if (currentGroup) {
          if (groups.length > 0) {
            const lastGroup = groups[groups.length - 1]
            lastGroup.blocks.push(...currentGroup.blocks)
            lastGroup.totalLength += currentGroup.totalLength
          } else {
            groups.push(currentGroup)
          }
        }

        currentGroup = {
          title: block.text,
          context: headingStack.filter(Boolean).join(' > '),
          blocks: [block],
          totalLength: block.text.length,
        }
      } else {
        if (!currentGroup) {
          currentGroup = {
            title: '',
            context: '',
            blocks: [],
            totalLength: 0,
          }
        }
        currentGroup.blocks.push(block)
        currentGroup.totalLength += block.text.length
      }
    }

    if (currentGroup) {
      if (currentGroup.totalLength < MIN_HEADING_CONTENT && groups.length > 0) {
        const lastGroup = groups[groups.length - 1]
        lastGroup.blocks.push(...currentGroup.blocks)
        lastGroup.totalLength += currentGroup.totalLength
      } else {
        groups.push(currentGroup)
      }
    }

    return groups
  }

  private validateAndRepair(groups: SemanticGroup[]): SemanticGroup[] {
    const result: SemanticGroup[] = []

    for (const group of groups) {
      if (group.totalLength > MAX_ENTRY_LENGTH) {
        const subGroups = this.splitLargeGroup(group)
        result.push(...subGroups)
      } else if (group.totalLength < MIN_ENTRY_LENGTH && result.length > 0) {
        const last = result[result.length - 1]
        last.blocks.push(...group.blocks)
        last.totalLength += group.totalLength
      } else {
        result.push(group)
      }
    }

    return result
  }

  private splitLargeGroup(group: SemanticGroup): SemanticGroup[] {
    const result: SemanticGroup[] = []
    let currentBlocks: ContentBlock[] = []
    let currentLength = 0

    for (const block of group.blocks) {
      if (block.type === 'heading' && currentLength >= IDEAL_ENTRY_LENGTH) {
        if (currentBlocks.length > 0) {
          result.push(this.makeGroup(currentBlocks, group))
        }
        currentBlocks = [block]
        currentLength = block.text.length
        continue
      }

      if (currentLength + block.text.length > MAX_ENTRY_LENGTH && currentLength >= MIN_ENTRY_LENGTH) {
        if (currentBlocks.length > 0) {
          result.push(this.makeGroup(currentBlocks, group))
        }
        currentBlocks = []
        currentLength = 0
      }

      if (block.text.length > MAX_ENTRY_LENGTH) {
        const subBlocks = this.splitOversizedBlock(block)
        for (const sub of subBlocks) {
          if (currentLength + sub.text.length > MAX_ENTRY_LENGTH && currentBlocks.length > 0) {
            result.push(this.makeGroup(currentBlocks, group))
            currentBlocks = []
            currentLength = 0
          }
          currentBlocks.push(sub)
          currentLength += sub.text.length
        }
      } else {
        currentBlocks.push(block)
        currentLength += block.text.length
      }
    }

    if (currentBlocks.length > 0) {
      result.push(this.makeGroup(currentBlocks, group))
    }

    return result
  }

  private splitOversizedBlock(block: ContentBlock): ContentBlock[] {
    if (block.type === 'list') {
      return this.splitListBlock(block)
    }
    if (block.type === 'table') {
      return this.splitTableBlock(block)
    }
    return this.splitParagraphBlock(block)
  }

  private splitListBlock(block: ContentBlock): ContentBlock[] {
    const items = block.text.split('\n')
    const result: ContentBlock[] = []
    let currentItems: string[] = []
    let currentLength = 0

    for (const item of items) {
      if (currentLength + item.length + 1 > MAX_ENTRY_LENGTH && currentItems.length > 0) {
        result.push({ ...block, text: currentItems.join('\n'), rawText: currentItems.join('\n') })
        currentItems = []
        currentLength = 0
      }
      currentItems.push(item)
      currentLength += item.length + 1
    }

    if (currentItems.length > 0) {
      result.push({ ...block, text: currentItems.join('\n'), rawText: currentItems.join('\n') })
    }

    return result.length > 0 ? result : [block]
  }

  private splitTableBlock(block: ContentBlock): ContentBlock[] {
    const lines = block.text.split('\n')
    const headerLine = lines[0]
    const separatorIdx = lines.findIndex(l => /^[-:| ]+$/.test(l.trim()))
    const separator = separatorIdx >= 0 ? lines[separatorIdx] : ''
    const dataStart = separatorIdx >= 0 ? separatorIdx + 1 : 1
    const dataLines = lines.slice(dataStart)

    const result: ContentBlock[] = []
    let currentLines: string[] = [headerLine, separator]
    let currentLength = headerLine.length + separator.length

    for (const line of dataLines) {
      if (currentLength + line.length > MAX_ENTRY_LENGTH && currentLines.length > 2) {
        result.push({ ...block, text: currentLines.join('\n'), rawText: currentLines.join('\n') })
        currentLines = [headerLine, separator]
        currentLength = headerLine.length + separator.length
      }
      currentLines.push(line)
      currentLength += line.length
    }

    if (currentLines.length > 2) {
      result.push({ ...block, text: currentLines.join('\n'), rawText: currentLines.join('\n') })
    }

    return result.length > 0 ? result : [block]
  }

  private splitParagraphBlock(block: ContentBlock): ContentBlock[] {
    const sentences = this.splitIntoSentences(block.text)
    const result: ContentBlock[] = []
    let currentText = ''

    for (const sentence of sentences) {
      if (currentText.length + sentence.length > MAX_ENTRY_LENGTH && currentText.length >= MIN_ENTRY_LENGTH) {
        result.push({ ...block, text: currentText.trim(), rawText: currentText.trim() })
        currentText = ''
      }
      currentText += sentence
    }

    if (currentText.trim()) {
      result.push({ ...block, text: currentText.trim(), rawText: currentText.trim() })
    }

    return result.length > 0 ? result : [block]
  }

  private splitIntoSentences(text: string): string[] {
    const sentences: string[] = []
    const regex = /[^。！？.!?\n]+[。！？.!?\n]?/g
    let match
    while ((match = regex.exec(text)) !== null) {
      if (match[0].trim()) sentences.push(match[0])
    }
    if (sentences.length === 0) {
      const chunkSize = MAX_ENTRY_LENGTH
      for (let i = 0; i < text.length; i += chunkSize) {
        sentences.push(text.slice(i, i + chunkSize))
      }
    }
    return sentences
  }

  private makeGroup(blocks: ContentBlock[], source: SemanticGroup): SemanticGroup {
    const contentBlocks = blocks.filter(b => b.type !== 'heading')
    const totalLength = contentBlocks.reduce((sum, b) => sum + b.text.length, 0)

    if (totalLength < MIN_ENTRY_LENGTH && contentBlocks.length === 0) {
      const headingBlock = blocks.find(b => b.type === 'heading')
      return {
        title: headingBlock?.text || source.title,
        context: source.context,
        blocks,
        totalLength: blocks.reduce((sum, b) => sum + b.text.length, 0),
      }
    }

    return {
      title: source.title,
      context: source.context,
      blocks,
      totalLength,
    }
  }

  private buildEntries(groups: SemanticGroup[], fileName: string): ExtractedEntry[] {
    const entries: ExtractedEntry[] = []

    for (const group of groups) {
      const contentParts: string[] = []
      let headingPrefix = ''

      for (const block of group.blocks) {
        if (block.type === 'heading') {
          headingPrefix = block.text
          continue
        }
        contentParts.push(block.text)
      }

      const content = contentParts.join('\n\n').trim()
      if (content.length < MIN_ENTRY_LENGTH) continue

      const title = group.context || headingPrefix || this.deriveTitle(content, fileName)
      const category = this.inferCategory(content)
      const confidence = this.assessConfidence(content, group)

      entries.push({ title, content, category, confidence })
    }

    if (entries.length === 0) {
      const fullContent = groups
        .flatMap(g => g.blocks)
        .filter(b => b.type !== 'heading')
        .map(b => b.text)
        .join('\n\n')
        .trim()

      if (fullContent.length >= MIN_ENTRY_LENGTH) {
        entries.push({
          title: this.deriveTitle(fullContent, fileName),
          content: fullContent,
          category: 'document',
          confidence: 0.5,
        })
      }
    }

    return entries
  }

  private isCompleteUnit(entry: ExtractedEntry): boolean {
    const content = entry.content.trim()

    if (content.length < MIN_ENTRY_LENGTH) return false

    const openBrackets = (content.match(/[\[（(【{《]/g) || []).length
    const closeBrackets = (content.match(/[\]）)】}》]/g) || []).length
    if (Math.abs(openBrackets - closeBrackets) > 1) return false

    const lines = content.split('\n')
    const lastLine = lines[lines.length - 1].trim()
    if (lastLine.endsWith('，') || lastLine.endsWith(',') || lastLine.endsWith('、')) return false

    const codeBlockOpen = (content.match(/```/g) || []).length
    if (codeBlockOpen % 2 !== 0) return false

    if (/^(首先|其次|然后|接着|因此|所以|综上|总之|但是|然而|不过|而且|此外|另外|同时|与此同时)/.test(content)) {
      if (!entry.title || entry.title.length < 3) return false
    }

    return true
  }

  private deriveTitle(content: string, fileName: string): string {
    const firstLine = content.split('\n')[0].trim()
    if (firstLine.length <= 60) return firstLine
    return firstLine.slice(0, 57) + '...'
  }

  private inferCategory(content: string): KnowledgeCategory {
    const lower = content.toLowerCase()
    if (/error|bug|fix|解决|修复|异常|故障/i.test(lower)) return 'error-solution'
    if (/decide|决定|决策|架构|方案选择/i.test(lower)) return 'decision'
    if (/api|endpoint|接口|请求|响应/i.test(lower)) return 'api'
    if (/best.?practice|最佳实践|规范|标准/i.test(lower)) return 'best-practice'
    if (/faq|常见问题|问答/i.test(lower)) return 'faq'
    if (/定义|概念|概述|简介|什么是/i.test(lower)) return 'concept'
    if (/步骤|流程|操作|安装|配置|部署/i.test(lower)) return 'reference'
    return 'document'
  }

  private assessConfidence(content: string, group: SemanticGroup): number {
    let score = 0.5

    if (group.context) score += 0.15
    if (content.length >= 200 && content.length <= 3000) score += 0.1
    if (content.length >= 100 && content.length <= 5000) score += 0.05

    const hasCompleteSentences = /[。！？.!?]/.test(content)
    if (hasCompleteSentences) score += 0.1

    const hasStructure = /(\n[-*+]\s|\n\d+[.)]\s|\n\|)/.test(content)
    if (hasStructure) score += 0.05

    const openBrackets = (content.match(/[\[（(【{《]/g) || []).length
    const closeBrackets = (content.match(/[\]）)】}》]/g) || []).length
    if (openBrackets === closeBrackets) score += 0.05

    return Math.min(score, 1.0)
  }
}

export const intelligentExtractor = new IntelligentExtractor()
