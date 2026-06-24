/**
 * 表单 Part 视图
 */
import type { AssistantPart } from '@intelligence/providerTypes'
import type { PartRenderContext } from '../types'
import { FormCard } from '../../FormCard'

export function FormPartView(part: AssistantPart, _ctx: PartRenderContext): React.ReactNode {
  const formPart = part as { form: any }
  return (
    <div className="my-2 w-full">
      <FormCard
        content={formPart.form}
        onSubmit={(values) => {
          const summary = Object.entries(values)
            .filter(([, v]) => v !== '' && v !== undefined && v !== false)
            .map(([k, v]) => {
              const field = formPart.form.fields.find((f: any) => f.id === k)
              return field ? `${field.label}: ${v}` : `${k}: ${v}`
            })
            .join('\n')
          window.dispatchEvent(new CustomEvent('chat-send-message', { detail: { content: summary } }))
        }}
      />
    </div>
  )
}
