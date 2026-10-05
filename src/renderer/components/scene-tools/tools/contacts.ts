/**
 * 通讯录数据域
 *
 * 向 AI Agent 暴露联系人的增删改查能力（经 scene_tools_* 通用工具）。
 * 与其它场景工具不同：通讯录面向全场景通用，入口在左下角用户菜单而非
 * 场景工具面板，因此不在 registry 中注册组件，仅通过 allDS 提供给 AI。
 */
import { useContactStore } from '../stores'
import type { ContactItem, ContactGender } from '../stores'
import type { SceneToolDS, TrackKeyFn, OpResult } from '../factory'

/** 关系预设选项 */
export const CONTACT_RELATIONS = ['家人', '亲戚', '朋友', '同事', '同学', '客户', '其他']

const GENDERS: ContactGender[] = ['male', 'female', 'other', 'unknown']

/** 允许写入的字段白名单 */
const WRITABLE_FIELDS = [
  'name',
  'phone',
  'gender',
  'birthday',
  'email',
  'address',
  'relation',
  'star',
  'company',
  'title',
  'tags',
  'note',
] as const

function normalizeGender(v: unknown): ContactGender | undefined {
  const s = String(v ?? '').trim()
  if (!s) return undefined
  if (GENDERS.includes(s as ContactGender)) return s as ContactGender
  const map: Record<string, ContactGender> = { 男: 'male', 女: 'female', 其他: 'other', 未知: 'unknown' }
  return map[s]
}

function normalizeStar(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  if (Number.isNaN(n)) return undefined
  return Math.max(0, Math.min(5, Math.round(n)))
}

function normalizeTags(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined
  const arr = Array.isArray(v) ? v : String(v).split(/[,，、\s]+/)
  const out = arr.map((tag) => String(tag).trim()).filter(Boolean)
  return Array.from(new Set(out))
}

function normalizeBirthday(v: unknown): string | undefined {
  const s = String(v ?? '').trim()
  if (!s) return undefined
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return undefined
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/** 从 AI 传入的对象中提取并归一化可写字段 */
function pickWritable(item: Record<string, unknown>): Partial<ContactItem> {
  const src: Record<string, unknown> = {}
  for (const key of WRITABLE_FIELDS) {
    if (key in item) src[key] = item[key]
  }
  const patch: Partial<ContactItem> = {}
  if ('name' in src) patch.name = String(src.name ?? '').trim()
  if ('phone' in src) patch.phone = String(src.phone ?? '').trim()
  if ('gender' in src) patch.gender = normalizeGender(src.gender)
  if ('birthday' in src) patch.birthday = normalizeBirthday(src.birthday)
  if ('email' in src) patch.email = String(src.email ?? '').trim() || undefined
  if ('address' in src) patch.address = String(src.address ?? '').trim() || undefined
  if ('relation' in src) patch.relation = String(src.relation ?? '').trim() || undefined
  if ('star' in src) patch.star = normalizeStar(src.star)
  if ('company' in src) patch.company = String(src.company ?? '').trim() || undefined
  if ('title' in src) patch.title = String(src.title ?? '').trim() || undefined
  if ('tags' in src) patch.tags = normalizeTags(src.tags)
  if ('note' in src) patch.note = String(src.note ?? '').trim() || undefined
  return patch
}

export const DS: SceneToolDS = {
  id: 'contacts',
  name: '通讯录',
  mode: 'work',
  description:
    '联系人管理：姓名、手机号、性别、生日、邮箱、地址、关系、星级、公司、标签，支持增删改查与按关系/标签筛选',
  itemSchema:
    'add: { name: string(必填,姓名), phone: string(必填,手机号), gender?: "male"|"female"|"other"|"unknown", birthday?: "YYYY-MM-DD", email?: string, address?: string, relation?: "家人"|"亲戚"|"朋友"|"同事"|"同学"|"客户"|"其他", star?: number(0-5 星级), company?: string, title?: string, tags?: string[](标签), note?: string(备注) }；update 传 id + 上述任意字段',
  read: () => {
    const items = useContactStore.getState().items
    return [...items].sort(
      (a, b) => (b.star ?? 0) - (a.star ?? 0) || a.name.localeCompare(b.name, 'zh'),
    )
  },
  add: (item): OpResult => {
    const patch = pickWritable(item)
    if (!patch.name) return { ok: false, error: '姓名（name）不能为空' }
    if (!patch.phone) return { ok: false, error: '手机号（phone）不能为空' }
    const created = useContactStore.getState().add({
      ...patch,
      name: patch.name,
      phone: patch.phone,
      updatedAt: Date.now(),
    })
    return { ok: true, id: created.id }
  },
  update: (id, patchRaw): OpResult => {
    const store = useContactStore.getState()
    if (!store.items.some((i) => i.id === id)) return { ok: false, error: `未找到联系人 ${id}` }
    const patch = pickWritable(patchRaw)
    if ('name' in patchRaw && !patch.name) return { ok: false, error: '姓名不能为空' }
    if ('phone' in patchRaw && !patch.phone) return { ok: false, error: '手机号不能为空' }
    store.update(id, { ...patch, updatedAt: Date.now() })
    return { ok: true }
  },
  remove: (id): OpResult => {
    const store = useContactStore.getState()
    if (!store.items.some((i) => i.id === id)) return { ok: false, error: `未找到联系人 ${id}` }
    store.remove(id)
    return { ok: true }
  },
}

export const trackKey: TrackKeyFn = (i) =>
  (i as { name?: string; id?: string })?.name ?? (i as { id?: string })?.id ?? ''
