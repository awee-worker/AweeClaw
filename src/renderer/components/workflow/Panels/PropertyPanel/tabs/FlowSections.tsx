import type { TabProps } from '../types'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS } from '../shared'

export function DelaySection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <Section title={language === 'zh' ? '延时' : 'Delay'}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={data.delayMs || 1000}
          onChange={(e) => onChange('delayMs', Number(e.target.value))}
          min={0}
          className={INPUT_CLASS}
        />
        <span className="text-[10px] text-[var(--text-muted)]">ms</span>
      </div>
    </Section>
  )
}

export function LoopSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={language === 'zh' ? '最大迭代次数' : 'Max Iterations'}>
        <input
          type="number"
          value={data.loopMaxIterations || 10}
          onChange={(e) => onChange('loopMaxIterations', Number(e.target.value))}
          min={1}
          className={INPUT_CLASS}
        />
      </Section>
      <Section title={language === 'zh' ? '循环变量' : 'Loop Variable'}>
        <input
          type="text"
          value={data.loopVariable || ''}
          onChange={(e) => onChange('loopVariable', e.target.value)}
          placeholder="loopItem"
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}

export function ParallelSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <Section title={language === 'zh' ? '并行策略' : 'Parallel Strategy'}>
      <select
        value={data.parallelStrategy || 'all'}
        onChange={(e) => onChange('parallelStrategy', e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="all">{language === 'zh' ? '全部完成' : 'All Complete'}</option>
        <option value="any">{language === 'zh' ? '任一完成' : 'Any Complete'}</option>
        <option value="count">{language === 'zh' ? '指定数量' : 'Count Based'}</option>
      </select>
    </Section>
  )
}

export function MergeSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <Section title={language === 'zh' ? '合并策略' : 'Merge Strategy'}>
      <select
        value={data.mergeStrategy || 'all'}
        onChange={(e) => onChange('mergeStrategy', e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="all">{language === 'zh' ? '等待全部' : 'Wait All'}</option>
        <option value="any">{language === 'zh' ? '等待任一' : 'Wait Any'}</option>
      </select>
    </Section>
  )
}
