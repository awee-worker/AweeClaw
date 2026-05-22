import type { TabProps } from '../types'
import { Section, HelpTip } from '../Section'
import { INPUT_CLASS, TEXTAREA_MONO_CLASS } from '../shared'

export function IOTab({ nodeType, data, onChange, language }: TabProps) {
  return (
    <>
      <Section
        title={language === 'zh' ? '输入变量' : 'Input Variables'}
        tip={language === 'zh' ? '从上游节点或全局变量获取数据' : 'Get data from upstream or global variables'}
      >
        <textarea
          value={data.inputVars ? Object.entries(data.inputVars).map(([k, v]) => `${k}: ${v}`).join('\n') : ''}
          onChange={(e) => {
            const vars: Record<string, string> = {}
            e.target.value.split('\n').filter(Boolean).forEach(line => {
              const [key, ...rest] = line.split(':')
              if (key) vars[key.trim()] = rest.join(':').trim()
            })
            onChange('inputVars', vars)
          }}
          placeholder={language === 'zh' ? '变量名: 表达式（每行一个）\n例如：\nname: {{agentReply}}\ncount: 42' : 'varName: expression (one per line)\ne.g.:\nname: {{agentReply}}\ncount: 42'}
          rows={3}
          className={TEXTAREA_MONO_CLASS}
        />
        <HelpTip>
          {language === 'zh'
            ? '使用 {{变量名}} 引用其他节点的输出，或直接写常量值'
            : 'Use {{varName}} to reference other nodes\' output, or write literal values'}
        </HelpTip>
      </Section>

      <Section
        title={language === 'zh' ? '输出变量名' : 'Output Variable'}
        tip={language === 'zh' ? '本节点执行结果保存到的变量名' : 'Variable name to save this node\'s result'}
      >
        <input
          type="text"
          value={data.outputVar || ''}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder="result"
          className={INPUT_CLASS}
        />
        <p className="mt-1 text-[10px] text-gray-400">
          {language === 'zh'
            ? '后续节点可使用 {{变量名}} 引用此输出'
            : 'Later nodes can reference this output via {{varName}}'}
        </p>
      </Section>

      {/* Sub-workflow specific mapping */}
      {nodeType === 'sub_workflow' && (
        <Section
          title={language === 'zh' ? '输出映射' : 'Output Mapping'}
          tip={language === 'zh' ? '将子工作流输出映射到当前变量' : 'Map sub-workflow outputs to current variables'}
        >
          <textarea
            value={data.outputMapping ? Object.entries(data.outputMapping).map(([k, v]) => `${k}: ${v}`).join('\n') : ''}
            onChange={(e) => {
              const mapping: Record<string, string> = {}
              e.target.value.split('\n').filter(Boolean).forEach(line => {
                const [key, ...rest] = line.split(':')
                if (key) mapping[key.trim()] = rest.join(':').trim()
              })
              onChange('outputMapping', mapping)
            }}
            placeholder={language === 'zh' ? '子输出: 当前变量名' : 'subOutput: currentVar'}
            rows={3}
            className={TEXTAREA_MONO_CLASS}
          />
        </Section>
      )}
    </>
  )
}