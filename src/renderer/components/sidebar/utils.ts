/**
 * Sidebar 共享工具函数
 */

export const getFileIcon = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase()
  const iconColors: Record<string, string> = {
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
  return iconColors[ext || ''] || 'text-text-muted'
}
