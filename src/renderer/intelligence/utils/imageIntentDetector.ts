/**
 * 图片意图检测 - 根据用户消息判断是否需要 AI 视觉分析图片内容
 * 引用模式（默认）：AI 只需知道文件路径
 * 分析模式：AI 需要看到图片像素内容
 */

const ANALYSIS_KEYWORDS_ZH = [
  '识别', '分析', '看看', '看下', '看一下', '描述', '这张图', '这个图',
  '图片里', '图片中', '图中', '画面', '画面中', '截图里', '截图中的',
  '识别出', '检测', '发现', '观察', '读取', '理解', '解读',
  '设计稿', 'UI稿', '原型图', '效果图', '界面图',
  '还原', '按照图', '参照图', '参考图', '根据图',
  'OCR', '文字识别',
]

const ANALYSIS_KEYWORDS_EN = [
  'describe', 'analyze', 'analyse', 'identify', 'recognize', 'detect',
  'what\'s in', 'what is in', 'what do you see', 'can you see',
  'read the', 'extract from', 'interpret',
  'in this image', 'in the image', 'in this picture', 'in the picture',
  'on this screen', 'on the screen', 'in this screenshot',
  'from this image', 'from the image',
  'mockup', 'design mockup', 'ui mockup', 'wireframe',
  'reproduce', 'replicate', 'convert this design',
  'according to this', 'based on this image', 'following this design',
  'ocr',
]

const ANALYSIS_PATTERNS = [
  /这[个张]图[片里中].*[是什么有看]/,
  /图[片里中].*[是什么有看]/,
  /按[照照这]?[个张]?图/,
  /参[照考][这]?[个张]?图/,
  /根[据据这]?[个张]?图/,
  /what.{0,5}(in|on|from).{0,5}(image|picture|screenshot|photo)/i,
  /(?:image|picture|screenshot|photo).{0,10}(show|contain|display|have)/i,
]

export function needsVisualAnalysis(userMessage: string): boolean {
  if (!userMessage || !userMessage.trim()) return false

  const lowerMessage = userMessage.toLowerCase()

  for (const keyword of ANALYSIS_KEYWORDS_ZH) {
    if (userMessage.includes(keyword)) return true
  }

  for (const keyword of ANALYSIS_KEYWORDS_EN) {
    if (lowerMessage.includes(keyword)) return true
  }

  for (const pattern of ANALYSIS_PATTERNS) {
    if (pattern.test(userMessage)) return true
  }

  return false
}
