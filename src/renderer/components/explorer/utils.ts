const EXT_HUE_MAP: Record<string, string> = {
  ts: 'text-blue-400',
  tsx: 'text-blue-400',
  js: 'text-yellow-400',
  jsx: 'text-yellow-400',
  py: 'text-green-400',
  json: 'text-yellow-300',
  md: 'text-gray-400',
  css: 'text-pink-400',
  html: 'text-orange-400',
  gitignore: 'text-gray-500',
}

export const getFileIcon = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase()
  return EXT_HUE_MAP[ext ?? ''] ?? 'text-text-muted'
}

export function classifyFile(name: string): 'code' | 'config' | 'document' | 'asset' | 'other' {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'rb', 'swift', 'kt', 'cs', 'php', 'sh', 'bash'].includes(ext)) return 'code'
  if (['json', 'yaml', 'yml', 'toml', 'env', 'gitignore', 'editorconfig', 'eslintrc', 'prettierrc'].includes(ext)) return 'config'
  if (['md', 'txt', 'rst', 'pdf', 'doc', 'docx'].includes(ext)) return 'document'
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'mp3', 'mp4'].includes(ext)) return 'asset'
  return 'other'
}
