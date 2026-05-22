import type { WorkflowNodeData } from '@shared/protocols/workflowV2'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS } from '../shared'

interface ErrorTabProps {
  data: WorkflowNodeData
  onChange: (field: string, value: unknown) => void
  language: 'en' | 'zh'
}

export function ErrorTab({ data, onChange, language }: ErrorTabProps) {
  const onError = data.onError

  return (
    <>
      <Section title={language === 'zh' ? '错误处理策略' : 'Error Handling Strategy'}>
        <select
          value={onError?.action || 'abort'}
          onChange={(e) => onChange('onError', { ...onError, action: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="abort">{language === 'zh' ? '中止工作流' : 'Abort Workflow'}</option>
          <option value="skip">{language === 'zh' ? '跳过继续' : 'Skip & Continue'}</option>
          <option value="retry">{language === 'zh' ? '重试' : 'Retry'}</option>
          <option value="goto">{language === 'zh' ? '跳转到节点' : 'Go to Node'}</option>
        </select>
      </Section>

      {onError?.action === 'retry' && (
        <>
          <Section title={language === 'zh' ? '最大重试次数' : 'Max Retries'}>
            <input
              type="number"
              value={onError.maxRetries || 3}
              onChange={(e) => onChange('onError', { ...onError, maxRetries: Number(e.target.value) })}
              min={1}
              max={10}
              className={INPUT_CLASS}
            />
          </Section>
          <Section title={language === 'zh' ? '重试间隔' : 'Retry Delay'}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={onError.retryDelayMs || 1000}
                onChange={(e) => onChange('onError', { ...onError, retryDelayMs: Number(e.target.value) })}
                min={0}
                className={INPUT_CLASS}
              />
              <span className="text-[10px] text-[var(--text-muted)]">ms</span>
            </div>
          </Section>
        </>
      )}

      {onError?.action === 'goto' && (
        <Section title={language === 'zh' ? '目标节点 ID' : 'Target Node ID'}>
          <input
            type="text"
            value={onError.gotoNodeId || ''}
            onChange={(e) => onChange('onError', { ...onError, gotoNodeId: e.target.value })}
            placeholder={language === 'zh' ? '节点 ID' : 'Node ID'}
            className={INPUT_CLASS}
          />
        </Section>
      )}

      <Section title={language === 'zh' ? '备用输出' : 'Fallback Output'}>
        <input
          type="text"
          value={onError?.fallbackOutput != null ? String(onError.fallbackOutput) : ''}
          onChange={(e) => onChange('onError', { ...onError, fallbackOutput: e.target.value || undefined })}
          placeholder={language === 'zh' ? '失败时的默认输出' : 'Default output on failure'}
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}
