/**
 * Word 文档生成器
 *
 * 使用 docx 库（需 npm install docx）将结构化会议纪要生成 .docx 文件 buffer。
 * 通过动态 import 加载 docx 库，避免未安装时构建报错；
 * 运行时若 docx 未安装则返回明确错误，调用方据以降级提示。
 *
 * 文档结构：标题 → 元信息(时间/参会人) → 摘要 → 议题 → 决议 → 待办
 * 中文字体显式设置为「微软雅黑/SimSun」，避免 macOS/Windows 乱码。
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { MeetingMinutes } from '@shared/protocols/meetingNotes'

/** 中文字体（macOS 用 PingFang SC，Windows 用微软雅黑，docx 会回退） */
const CN_FONT = 'Microsoft YaHei'

/**
 * 生成 .docx 文件 buffer
 *
 * @param minutes 结构化会议纪要
 * @returns 成功返回 Buffer，失败返回 null
 */
export async function generateDocxBuffer(minutes: MeetingMinutes): Promise<Buffer | null> {
  let docxLib: typeof import('docx') | null = null
  try {
    // 动态加载 docx 库（避免构建期硬依赖，运行时按需加载）
    docxLib = await import('docx')
  } catch (err) {
    logger.system.error('[DocxGenerator] docx 库未安装或加载失败：', err)
    return null
  }

  try {
    const {
      Document,
      Packer,
      Paragraph,
      TextRun,
      HeadingLevel,
      AlignmentType,
    } = docxLib

    const children: InstanceType<typeof Paragraph>[] = []

    // 标题
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: minutes.title || '会议纪要',
            bold: true,
            size: 36, // 18pt
            font: CN_FONT,
          }),
        ],
      }),
    )

    // 元信息：时间 / 参会人
    const metaLine = `日期：${minutes.date}    时间：${minutes.startTime} - ${minutes.endTime}`
    children.push(
      new Paragraph({
        children: [new TextRun({ text: metaLine, size: 22, font: CN_FONT, color: '666666' })],
        spacing: { after: 100 },
      }),
    )

    if (minutes.attendees && minutes.attendees.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `参会人：${minutes.attendees.join('、')}`,
              size: 22,
              font: CN_FONT,
              color: '666666',
            }),
          ],
          spacing: { after: 200 },
        }),
      )
    }

    // 摘要
    if (minutes.summary) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '会议摘要', bold: true, size: 28, font: CN_FONT })],
          spacing: { before: 200, after: 100 },
        }),
      )
      children.push(
        new Paragraph({
          children: [new TextRun({ text: minutes.summary, size: 22, font: CN_FONT })],
          spacing: { after: 200 },
        }),
      )
    }

    // 议题
    if (minutes.topics && minutes.topics.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '讨论议题', bold: true, size: 28, font: CN_FONT })],
          spacing: { before: 200, after: 100 },
        }),
      )
      minutes.topics.forEach((topic, idx) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${idx + 1}. ${topic.title}`,
                bold: true,
                size: 24,
                font: CN_FONT,
              }),
            ],
            spacing: { before: 100, after: 60 },
          }),
        )
        if (topic.discussion) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: topic.discussion, size: 22, font: CN_FONT })],
              spacing: { after: 100 },
              indent: { left: 360 },
            }),
          )
        }
      })
    }

    // 决议
    if (minutes.decisions && minutes.decisions.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '会议决议', bold: true, size: 28, font: CN_FONT })],
          spacing: { before: 200, after: 100 },
        }),
      )
      minutes.decisions.forEach((decision, idx) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${idx + 1}. ${decision}`,
                size: 22,
                font: CN_FONT,
              }),
            ],
            spacing: { after: 60 },
            indent: { left: 360 },
          }),
        )
      })
    }

    // 待办事项
    if (minutes.actionItems && minutes.actionItems.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '待办事项', bold: true, size: 28, font: CN_FONT })],
          spacing: { before: 200, after: 100 },
        }),
      )
      minutes.actionItems.forEach((item, idx) => {
        const assignee = item.assignee ? ` (@${item.assignee})` : ''
        const deadline = item.deadline ? ` [截止: ${item.deadline}]` : ''
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${idx + 1}. ${item.task}${assignee}${deadline}`,
                size: 22,
                font: CN_FONT,
              }),
            ],
            spacing: { after: 60 },
            indent: { left: 360 },
          }),
        )
      })
    }

    // 构建 Document
    const doc = new Document({
      sections: [
        {
          properties: {},
          children,
        },
      ],
    })

    const buffer = await Packer.toBuffer(doc)
    logger.system.info('[DocxGenerator] docx 生成成功', {
      title: minutes.title,
      bytes: buffer.length,
    })
    return buffer
  } catch (err) {
    logger.system.error('[DocxGenerator] 生成 docx 失败：', err)
    return null
  }
}
