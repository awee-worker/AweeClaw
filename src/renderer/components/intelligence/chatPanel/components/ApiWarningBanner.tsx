/**
 * API 密钥/云登录警告横幅
 */
import { AlertTriangle } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

interface ApiWarningBannerProps {
  hasApiKey: boolean
  needsCloudLogin: boolean
  language: Language
  isChatPrimary: boolean
}

export function ApiWarningBanner({
  hasApiKey,
  needsCloudLogin,
  language,
  isChatPrimary,
}: ApiWarningBannerProps) {
  if (hasApiKey) return null

  return (
    <div
      className={`m-4 p-4 border border-warning/20 bg-warning/5 rounded-xl flex gap-3 backdrop-blur-sm relative z-10 ${
        isChatPrimary ? 'max-w-[800px] mx-auto' : ''
      }`}
    >
      <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
      <div>
        <span className="font-medium text-sm text-warning block mb-1">
          {needsCloudLogin ? t('cloudLoginRequired', language) : t('setupRequired', language)}
        </span>
        <p className="text-xs text-text-muted">
          {needsCloudLogin ? t('cloudLoginRequiredDesc', language) : t('setupRequiredDesc', language)}
        </p>
      </div>
    </div>
  )
}
