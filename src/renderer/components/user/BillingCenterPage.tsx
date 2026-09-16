import { useState, useCallback, lazy, Suspense } from 'react'
import {
  CreditCard,
  FileText,
  Receipt,
  BarChart3,
  Package,
  ArrowLeft,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { type BillingTab } from './tabs'
import { OrdersPanel } from './tabs/OrdersPanel'
import { MyPurchasesPanel } from './tabs/MyPurchasesPanel'
import { InvoicesPanel } from './tabs/InvoicesPanel'
import { PaymentsPanel } from './tabs/PaymentsPanel'
const UsagePanel = lazy(() => import('./tabs/UsagePanel').then(m => ({ default: m.UsagePanel })))
import { t, type Language } from '@renderer/i18n'

const billingTabs: { id: BillingTab; icon: React.ReactNode; labelZh: string; labelEn: string }[] = [
  { id: 'orders', icon: <CreditCard className="w-4 h-4" />, labelZh: '订单管理', labelEn: 'Orders' },
  { id: 'purchases', icon: <Package className="w-4 h-4" />, labelZh: '我的购买', labelEn: 'Purchases' },
  { id: 'invoices', icon: <FileText className="w-4 h-4" />, labelZh: '发票管理', labelEn: 'Invoices' },
  { id: 'payments', icon: <Receipt className="w-4 h-4" />, labelZh: '消费记录', labelEn: 'Payments' },
  { id: 'usage', icon: <BarChart3 className="w-4 h-4" />, labelZh: '使用统计', labelEn: 'Usage' },
]

export default function BillingCenterPage() {
  const { language, setShowBillingCenterPage } = useStore(useShallow(s => ({
    language: s.language,
    setShowBillingCenterPage: s.setShowBillingCenterPage,
  })))

  const [activeTab, setActiveTab] = useState<BillingTab>('orders')

  const handleClose = useCallback(() => {
    setShowBillingCenterPage(false)
  }, [setShowBillingCenterPage])

  return (
    <div className="flex h-full w-full relative">
      <div className="bg-surface/30 backdrop-blur-xl flex flex-col pt-10 pb-6 w-56 border-r border-border/40 shadow-xl shadow-black/10">
        <div className="px-4 mb-4">
          <button
            onClick={handleClose}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent transition-all duration-200 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-200" />
            <span>{t('settings.backToApp', language as Language)}</span>
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
          {billingTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 group ${
                activeTab === tab.id
                  ? 'bg-accent/10 text-text-primary border border-accent/20'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'
              }`}
            >
              <span className={`transition-colors duration-200 ${activeTab === tab.id ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`}>
                {tab.icon}
              </span>
              <span>{language === 'zh' ? tab.labelZh : tab.labelEn}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 flex justify-center overflow-hidden">
        <div className="w-full max-w-[1000px] flex flex-col min-w-0 bg-transparent relative">
          <div className="shrink-0 px-8 pt-10 pb-4 border-b border-border/40 drag-region">
            <div className="no-drag">
              <h3 className="text-2xl font-semibold text-text-primary tracking-tight">
                {billingTabs.find(tab => tab.id === activeTab)?.[language === 'zh' ? 'labelZh' : 'labelEn']}
              </h3>
              <p className="text-sm text-text-muted mt-1.5 opacity-80">
                {t('user.manageyourbillingandusage', language as Language)}
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar pb-28">
            <div className="space-y-6">
              {activeTab === 'orders' && <OrdersPanel key="orders" language={language as Language} />}
              {activeTab === 'purchases' && <MyPurchasesPanel key="purchases" language={language as Language} />}
              {activeTab === 'invoices' && <InvoicesPanel key="invoices" language={language as Language} />}
              {activeTab === 'payments' && <PaymentsPanel key="payments" language={language as Language} />}
              {activeTab === 'usage' && <Suspense fallback={<div className="p-4 text-muted-foreground">Loading charts...</div>}><UsagePanel key="usage" language={language as Language} /></Suspense>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
