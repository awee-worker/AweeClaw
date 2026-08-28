import { listDS } from '../../factory'
import { useLedgerStore } from '../../stores'
import type { TrackKeyFn } from '../../factory'

export const DS = listDS(
  'life-ledger',
  '记账本',
  'life',
  '收支记录、分类统计',
  'add: { amount: number(必填, 正数), type: "income"|"expense"(必填), category: string(必填), date?: "YYYY-MM-DD", note?: string }；update 支持 amount/type/category/note',
  () => useLedgerStore.getState(),
)

export const trackKey: TrackKeyFn = (i) => `${(i as any)?.category ?? ''} ¥${(i as any)?.amount ?? ''}`
