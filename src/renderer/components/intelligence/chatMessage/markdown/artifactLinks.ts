/**
 * 正文里的文件路径识别与链接化
 *
 * 助手回复中的产物路径大多是裸文本（「已生成 presentations/xxx.pptx」），Markdown
 * 不会把它当成链接，用户只能自己复制路径再去打开。这里提供两件事：
 *
 * 1. `looksLikeFilePath`：判断一段文本是不是文件路径，供行内 code 渲染器复用；
 * 2. `linkifyArtifactPaths`：渲染前把正文中的裸路径包成行内代码，交给 code
 *    渲染器统一处理，产物因此可以直接点开预览。
 *
 * 只在普通文本行内替换，围栏代码块与已有的行内代码都保持原样。
 */

/** 产物类扩展名：文档、表格、演示、图片、音视频、压缩包、3D 模型等 */
const ARTIFACT_EXTENSION = /\.(docx?|xlsx?|pptx?|pdf|csv|tsv|jsonl?|ya?ml|txt|markdown?|html?|xml|png|jpe?g|gif|webp|bmp|ico|svg|mp4|mov|webm|avi|mp3|wav|m4a|zip|7z|tar|gz|glb|gltf|obj|fbx|stl|ipynb|drawio|har|log)$/i

/** 代码类扩展名 */
const CODE_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs|vue|uvue|md|json|css|scss|less|html|go|rs|py|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|sql)$/i

/** 路径扫描时可用的分隔边界（出现即视为路径结束） */
const BOUNDARY = '[\\s()\\[\\]{}<>*"\'`|，。、；：！？（）【】「」『』《》…·]'

/** 路径内部允许的字符（边界字符与引号都不允许） */
const TOKEN = '[^\\s()\\[\\]{}<>*"\'`|，。、；：！？（）【】「」『』《》…·]'

/** 带目录的路径：至少一个分隔符 + 已知扩展名，允许尾部带行号 */
const PATH_PATTERN = new RegExp(
  `(^|${BOUNDARY})(${TOKEN}*[\\\\/]${TOKEN}*\\.(${[
    'docx?', 'xlsx?', 'pptx?', 'pdf', 'csv', 'tsv', 'jsonl?', 'ya?ml', 'txt', 'markdown?',
    'html?', 'xml', 'png', 'jpe?g', 'gif', 'webp', 'bmp', 'ico', 'svg', 'mp4', 'mov',
    'webm', 'avi', 'mp3', 'wav', 'm4a', 'zip', '7z', 'tar', 'gz', 'glb', 'gltf', 'obj',
    'fbx', 'stl', 'ipynb', 'drawio', 'har', 'log',
    'tsx?', 'jsx?', 'mjs', 'cjs', 'vue', 'uvue', 'md', 'json', 'css', 'scss', 'less',
    'go', 'rs', 'py', 'java', 'kt', 'swift', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'rb',
    'php', 'sh', 'sql',
  ].join('|')})(?::\\d+)?)(?=$|${BOUNDARY})`,
  'gi',
)

/** 无目录的产物文件名（report.docx / deck.pptx），只在强扩展名上生效 */
const BARE_ARTIFACT_PATTERN = new RegExp(
  `(^|${BOUNDARY})([\\w.\\u4e00-\\u9fa5-]+\\.(?:docx?|xlsx?|pptx?|pdf|csv|png|jpe?g|svg|mp4|glb|gltf|zip|html?))(?=$|${BOUNDARY})`,
  'gi',
)

/** 是否形如文件路径（行内 code 是否走「点击打开文件」的判定） */
export function looksLikeFilePath(text: string): boolean {
  const value = String(text ?? '').trim()
  if (value.length < 3) return false
  if (/[\s\n]/.test(value)) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false
  // 允许 "src/a.ts:12" 这种带行号写法：后缀不属于路径本身
  const withoutLine = value.replace(/:\d+$/, '')
  if (ARTIFACT_EXTENSION.test(withoutLine) || CODE_EXTENSION.test(withoutLine)) return true
  // 没有扩展名时按目录形态判断：src/components 这类位置同样值得打开
  return /[\\/]/.test(withoutLine)
}

/**
 * 把正文中的裸路径包成行内代码
 *
 * 已经是代码块、行内代码、Markdown 链接、HTML 标签或网址的片段不再处理，
 * 否则会破坏原有语法。
 */
export function linkifyArtifactPaths(markdown: string): string {
  if (!markdown || markdown.indexOf('.') === -1) return markdown

  const guarded: string[] = []
  const guard = (segment: string): string => {
    guarded.push(segment)
    return `\u0000${guarded.length - 1}\u0000`
  }

  const lines = markdown.split('\n')
  let inFence = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence || line.indexOf('.') === -1) continue

    const protectedLine = line
      .replace(/`[^`\n]*`/g, match => guard(match))
      .replace(/!?\[[^\]\n]*\]\([^)\n]*\)/g, match => guard(match))
      .replace(/<[^>\n]+>/g, match => guard(match))
      .replace(/https?:\/\/[^\s<>"'\u0000]+/g, match => guard(match))

    const linked = protectedLine
      .replace(PATH_PATTERN, (match, prefix: string, token: string) => {
        if (!looksLikeFilePath(token)) return match
        return `${prefix || ''}\`${token}\``
      })
      .replace(BARE_ARTIFACT_PATTERN, (match, prefix: string, token: string) => {
        if (!looksLikeFilePath(token)) return match
        return `${prefix || ''}\`${token}\``
      })

    lines[i] = linked
  }

  const result = lines.join('\n')
  if (guarded.length === 0) return result

  // 还原被保护的片段。占位符编号在当前行内唯一，但跨行的编号会重复出现，
  // 因此整篇一起还原而不是逐行还原。
  return result.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => guarded[Number(index)] ?? '')
}
