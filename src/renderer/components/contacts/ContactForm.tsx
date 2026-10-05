/**
 * 联系人新增 / 编辑表单
 */
import { useState, type ReactNode } from 'react'
import { Star } from 'lucide-react'
import type { ContactGender, ContactItem } from '../scene-tools/stores'
import { GENDER_OPTIONS, RELATION_OPTIONS } from './contactUtils'

/** 表单提交值：不含系统字段 */
export type ContactDraft = Omit<ContactItem, 'id' | 'createdAt' | 'updatedAt'>

interface ContactFormProps {
  initial?: Partial<ContactItem>
  submitLabel?: string
  onSubmit: (values: ContactDraft) => void
  onCancel: () => void
}

const inputClass =
  'w-full h-8 px-2.5 rounded-lg bg-background border border-border/50 text-[13px] text-text-primary outline-none focus:border-accent/60 transition-colors'

export function ContactForm({ initial, submitLabel = '保存', onSubmit, onCancel }: ContactFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [gender, setGender] = useState<ContactGender | ''>(initial?.gender ?? '')
  const [birthday, setBirthday] = useState(initial?.birthday ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [relation, setRelation] = useState(initial?.relation ?? '')
  const [star, setStar] = useState(initial?.star ?? 0)
  const [company, setCompany] = useState(initial?.company ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join('、'))
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('请填写姓名')
      return
    }
    if (!phone.trim()) {
      setError('请填写手机号')
      return
    }
    const tags = tagsText.split(/[,，、\s]+/).map((tag) => tag.trim()).filter(Boolean)
    onSubmit({
      name: name.trim(),
      phone: phone.trim(),
      gender: gender || undefined,
      birthday: birthday || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      relation: relation || undefined,
      star: star > 0 ? star : undefined,
      company: company.trim() || undefined,
      title: title.trim() || undefined,
      tags: tags.length ? tags : undefined,
      note: note.trim() || undefined,
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-4 space-y-3">
        <Field label="姓名" required>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="必填" />
        </Field>
        <Field label="手机号" required>
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="必填" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="性别">
            <select
              className={inputClass}
              value={gender}
              onChange={(e) => setGender(e.target.value as ContactGender | '')}
            >
              <option value="">未设置</option>
              {GENDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="出生日期">
            <input type="date" className={inputClass} value={birthday} onChange={(e) => setBirthday(e.target.value)} />
          </Field>
        </div>
        <Field label="邮箱">
          <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </Field>
        <Field label="地址">
          <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="关系">
            <select className={inputClass} value={relation} onChange={(e) => setRelation(e.target.value)}>
              <option value="">未设置</option>
              {RELATION_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="星级">
            <StarPicker value={star} onChange={setStar} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="公司 / 单位">
            <input className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} />
          </Field>
          <Field label="职位">
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <Field label="标签" hint="多个标签用逗号分隔">
          <input
            className={inputClass}
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="如：老同学、供应商"
          />
        </Field>
        <Field label="备注">
          <textarea
            className="w-full h-16 px-2.5 py-1.5 rounded-lg bg-background border border-border/50 text-[13px] text-text-primary outline-none focus:border-accent/60 resize-none transition-colors"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {error && <div className="text-[12px] text-red-400">{error}</div>}
      </div>
      <div className="flex items-center gap-2 px-6 py-3 border-t border-border/40 shrink-0">
        <button
          onClick={onCancel}
          className="flex-1 h-8 rounded-lg text-[13px] text-text-secondary border border-border/50 hover:bg-surface-hover transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="flex-1 h-8 rounded-lg text-[13px] font-medium text-white transition-colors"
          style={{ background: 'rgb(var(--accent))' }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <div className="flex items-center gap-1 mb-1">
        <span className="text-[12px] text-text-muted">{label}</span>
        {required && <span className="text-red-400 text-[12px]">*</span>}
        {hint && <span className="text-[11px] text-text-muted/50 ml-auto">{hint}</span>}
      </div>
      {children}
    </label>
  )
}

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 h-8">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(value === n ? 0 : n)} className="p-0.5">
          <Star
            className="w-4 h-4"
            style={{ color: n <= value ? '#F59E0B' : '#9CA3AF' }}
            fill={n <= value ? '#F59E0B' : 'none'}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  )
}
