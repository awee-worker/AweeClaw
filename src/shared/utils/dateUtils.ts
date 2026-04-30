/**
 * 日期时间处理工具函数
 */

/**
 * 获取相对时间描述
 * @param timestamp 时间戳
 * @param language 语言代码 'zh' | 'en'
 * @returns 相对时间字符串 (e.g., "5分钟前", "Just now")
 */
export function getRelativeTime(timestamp: number, language: string = 'en'): string {
  const now = Date.now()
  const diff = now - timestamp
  
  // 防止未来时间导致的负数
  if (diff < 0) {
    return language === 'zh' ? '刚刚' : 'Just now'
  }

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) {
    return language === 'zh' ? '刚刚' : 'Just now'
  }
  
  if (diff < hour) {
    const minutes = Math.floor(diff / minute)
    return language === 'zh' ? `${minutes}分钟前` : `${minutes}m ago`
  }
  
  if (diff < day) {
    const hours = Math.floor(diff / hour)
    return language === 'zh' ? `${hours}小时前` : `${hours}h ago`
  }
  
  if (diff < 2 * day) {
    return language === 'zh' ? '昨天' : 'Yesterday'
  }
  
  if (diff < 7 * day) {
    const days = Math.floor(diff / day)
    return language === 'zh' ? `${days}天前` : `${days}d ago`
  }
  
  // 超过一周显示具体日期
  return new Date(timestamp).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { 
    month: 'short', 
    day: 'numeric',
    // 如果不是今年，显示年份
    year: new Date(timestamp).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
  })
}
