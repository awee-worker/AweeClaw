import type { TabProps } from '../types'
import type { HttpAuthConfig } from '@shared/protocols/workflowV2'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS } from '../shared'

export function AdvancedTab({ nodeType, data, onChange, language }: TabProps) {
  return (
    <>
      <Section
        title={language === 'zh' ? '超时设置' : 'Timeout'}
        tip={language === 'zh' ? '执行超时后自动终止' : 'Auto-terminate after timeout'}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={data.timeout || 0}
            onChange={(e) => onChange('timeout', Number(e.target.value))}
            min={0}
            step={1000}
            className={INPUT_CLASS}
          />
          <span className="text-[10px] text-gray-400 whitespace-nowrap">ms (0 = {language === 'zh' ? '不限' : 'unlimited'})</span>
        </div>
      </Section>

      <Section
        title={language === 'zh' ? '失败重试' : 'Retry on Failure'}
        tip={language === 'zh' ? '节点执行失败后的重试策略' : 'Retry strategy on node failure'}
      >
        <RetryPolicyEditor data={data} onChange={onChange} language={language} />
      </Section>

      <Section
        title={language === 'zh' ? '异常处理' : 'Error Handling'}
        tip={language === 'zh' ? '执行出错时的处理方式' : 'How to handle execution errors'}
      >
        <ErrorHandlerEditor data={data} onChange={onChange} language={language} />
      </Section>

      {nodeType === 'http_request' && <HttpAuthSection data={data} onChange={onChange} language={language} />}
    </>
  )
}

/* ===== Retry Policy Editor ===== */

function RetryPolicyEditor({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  const rp = data.retryPolicy || { maxRetries: 0, delayMs: 1000, backoff: 'fixed' as const }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9px] text-gray-400 mb-0.5 block">
            {language === 'zh' ? '最大重试' : 'Max Retries'}
          </label>
          <input
            type="number"
            value={rp.maxRetries}
            onChange={(e) => onChange('retryPolicy', { ...rp, maxRetries: Number(e.target.value) })}
            min={0}
            max={10}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className="text-[9px] text-gray-400 mb-0.5 block">
            {language === 'zh' ? '延迟(ms)' : 'Delay (ms)'}
          </label>
          <input
            type="number"
            value={rp.delayMs}
            onChange={(e) => onChange('retryPolicy', { ...rp, delayMs: Number(e.target.value) })}
            min={0}
            step={500}
            className={INPUT_CLASS}
          />
        </div>
      </div>
      <div>
        <label className="text-[9px] text-gray-400 mb-0.5 block">
          {language === 'zh' ? '退避策略' : 'Backoff'}
        </label>
        <div className="flex gap-1.5">
          {(['fixed', 'exponential'] as const).map(b => (
            <button
              key={b}
              onClick={() => onChange('retryPolicy', { ...rp, backoff: b })}
              className={`flex-1 px-2 py-1 text-[11px] rounded-lg border transition-all ${
                rp.backoff === b
                  ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                  : 'bg-white border-gray-150 text-gray-500'
              }`}
            >
              {b === 'fixed' ? (language === 'zh' ? '固定' : 'Fixed') : (language === 'zh' ? '指数' : 'Exp')}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ===== Error Handler Editor ===== */

function ErrorHandlerEditor({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  const eh = data.onError || { action: 'abort' as const }

  const actions = [
    { value: 'retry', zh: '重试', en: 'Retry' },
    { value: 'skip', zh: '跳过', en: 'Skip' },
    { value: 'abort', zh: '中止', en: 'Abort' },
    { value: 'goto', zh: '跳转', en: 'Go To' },
  ]

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {actions.map(a => (
          <button
            key={a.value}
            onClick={() => onChange('onError', { ...eh, action: a.value as 'retry' | 'skip' | 'abort' | 'goto' })}
            className={`flex-1 px-2 py-1.5 text-[11px] rounded-lg border transition-all ${
              eh.action === a.value
                ? 'bg-red-50 border-red-300 text-red-700 font-medium'
                : 'bg-white border-gray-150 text-gray-500'
            }`}
          >
            {language === 'zh' ? a.zh : a.en}
          </button>
        ))}
      </div>

      {eh.action === 'goto' && (
        <div>
          <label className="text-[9px] text-gray-400 mb-0.5 block">
            {language === 'zh' ? '跳转目标节点 ID' : 'Target Node ID'}
          </label>
          <input
            type="text"
            value={eh.gotoNodeId || ''}
            onChange={(e) => onChange('onError', { ...eh, gotoNodeId: e.target.value })}
            placeholder="node-xxx"
            className={INPUT_CLASS}
          />
        </div>
      )}

      {eh.action === 'retry' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[9px] text-gray-400 mb-0.5 block">
              {language === 'zh' ? '重试次数' : 'Retry Count'}
            </label>
            <input
              type="number"
              value={eh.maxRetries || 3}
              onChange={(e) => onChange('onError', { ...eh, maxRetries: Number(e.target.value) })}
              min={1}
              max={10}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="text-[9px] text-gray-400 mb-0.5 block">
              {language === 'zh' ? '延迟(ms)' : 'Delay (ms)'}
            </label>
            <input
              type="number"
              value={eh.retryDelayMs || 1000}
              onChange={(e) => onChange('onError', { ...eh, retryDelayMs: Number(e.target.value) })}
              min={0}
              step={500}
              className={INPUT_CLASS}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/* ===== HTTP Auth Section ===== */

function HttpAuthSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  const auth: HttpAuthConfig = data.httpAuth || { type: 'none' }

  return (
    <Section
      title={language === 'zh' ? '认证方式' : 'Authentication'}
      tip={language === 'zh' ? 'API请求的认证方式' : 'API request authentication'}
    >
      <select
        value={auth.type}
        onChange={(e) => onChange('httpAuth', { ...auth, type: e.target.value })}
        className={SELECT_CLASS}
      >
        <option value="none">{language === 'zh' ? '无需认证' : 'No Auth'}</option>
        <option value="bearer">Bearer Token</option>
        <option value="basic">Basic Auth</option>
        <option value="api-key">API Key</option>
      </select>

      {auth.type === 'bearer' && (
        <input
          type="password"
          value={auth.token || ''}
          onChange={(e) => onChange('httpAuth', { ...auth, token: e.target.value })}
          placeholder="eyJhbG..."
          className={`mt-2 ${INPUT_CLASS}`}
        />
      )}

      {auth.type === 'basic' && (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            value={auth.user || ''}
            onChange={(e) => onChange('httpAuth', { ...auth, user: e.target.value })}
            placeholder={language === 'zh' ? '用户名' : 'Username'}
            className={INPUT_CLASS}
          />
          <input
            type="password"
            value={auth.pass || ''}
            onChange={(e) => onChange('httpAuth', { ...auth, pass: e.target.value })}
            placeholder={language === 'zh' ? '密码' : 'Password'}
            className={INPUT_CLASS}
          />
        </div>
      )}

      {auth.type === 'api-key' && (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            value={auth.headerName || ''}
            onChange={(e) => onChange('httpAuth', { ...auth, headerName: e.target.value })}
            placeholder={language === 'zh' ? 'Header 名 (如 X-API-Key)' : 'Header name (e.g. X-API-Key)'}
            className={INPUT_CLASS}
          />
          <input
            type="password"
            value={auth.headerValue || ''}
            onChange={(e) => onChange('httpAuth', { ...auth, headerValue: e.target.value })}
            placeholder={language === 'zh' ? 'Header 值' : 'Header value'}
            className={INPUT_CLASS}
          />
        </div>
      )}
    </Section>
  )
}