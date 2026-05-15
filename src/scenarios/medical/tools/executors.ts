import type { ToolExecutionResult, ToolExecutionContext } from '@protocols'
import type {
  SymptomAnalysisResult,
  SymptomSeverity,
  ReportInterpretation,
  DrugInfo,
  ClinicalGuideline,
  HealthAssessment,
  LiteratureReview,
  EvidenceLevel,
  ReportStatus,
} from '../providerTypes'

const MEDICAL_DISCLAIMER = '\n\n⚠️ **重要免责声明**: 以上信息仅供参考，不构成医疗建议、诊断或治疗方案。请务必咨询合格的医疗专业人员获取个性化医疗建议。'

function medError(message: string): ToolExecutionResult {
  return { success: false, result: '', error: message }
}

function medSuccess(result: string, meta?: Record<string, unknown>): ToolExecutionResult {
  return { success: true, result, meta }
}

function severityIcon(s: SymptomSeverity): string {
  const map: Record<SymptomSeverity, string> = { mild: '🟢', moderate: '🟡', severe: '🔴', critical: '⚫' }
  return map[s] || '⚪'
}

function evidenceIcon(e: EvidenceLevel): string {
  const map: Record<EvidenceLevel, string> = { strong: '🟢', moderate: '🟡', limited: '🔴', insufficient: '⚫' }
  return map[e] || '⚪'
}

function urgencyLabel(u: string): string {
  const map: Record<string, string> = { routine: '📋 常规', urgent: '⚠️ 紧急', emergency: '🚨 急诊' }
  return map[u] || u
}

function statusIcon(s: ReportStatus): string {
  const map: Record<ReportStatus, string> = { normal: '✅', abnormal: '⚠️', borderline: '🟡', critical: '🚨' }
  return map[s] || '❓'
}

async function symptomAnalysis(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const symptoms = args.symptoms as string[]
  const duration = args.duration as string | undefined
  const severity = (args.severity as SymptomSeverity) || 'moderate'
  const age = args.age as number | undefined
  const gender = args.gender as string | undefined
  const medicalHistory = args.medical_history as string[] | undefined
  const currentMedications = args.current_medications as string[] | undefined

  if (!symptoms?.length) return medError('At least one symptom is required')

  try {
    const result: Partial<SymptomAnalysisResult> = {
      id: `symptom_${Date.now()}`,
      symptoms: symptoms.map(s => ({
        id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: s,
        nameZh: s,
        description: s,
        descriptionZh: s,
        severity,
        associatedSymptoms: [],
        redFlags: [],
      })),
      differentials: [],
      redFlags: [],
      recommendations: [],
      disclaimer: 'This analysis is for reference only and does not constitute medical advice. Please consult a qualified healthcare professional.',
      analyzedAt: Date.now(),
    }

    const lines = [
      `**症状分析**${MEDICAL_DISCLAIMER}`,
      '',
      `🔍 **报告症状**: ${symptoms.join(', ')}`,
      `${duration ? `⏰ **持续时间**: ${duration}` : ''}`,
      `${severity ? `📊 **严重程度**: ${severityIcon(severity)} ${severity}` : ''}`,
      `${urgencyLabel('routine') ? `📋 **紧急程度**: ${urgencyLabel(severity === 'critical' ? 'emergency' : severity === 'severe' ? 'urgent' : 'routine')}` : ''}`,
      `${age ? `👤 **年龄**: ${age}岁` : ''}`,
      `${gender ? `⚧ **性别**: ${gender}` : ''}`,
      '',
      '---',
      '',
      '### 📋 分析说明',
      '',
      '本工具将基于症状进行初步分析，包括：',
      '1. **鉴别诊断** — 可能的疾病列表及可能性评估',
      '2. **红旗标志** — 需要紧急就医的警示信号',
      '3. **建议检查** — 推荐的医学检查项目',
      '4. **就医建议** — 何时应寻求医疗帮助',
      '',
      `${medicalHistory?.length ? `**既往病史**: ${medicalHistory.join(', ')}` : ''}`,
      `${currentMedications?.length ? `**当前用药**: ${currentMedications.join(', ')}` : ''}`,
      '',
      '### 🚨 紧急就医指征',
      '',
      '如出现以下情况，请**立即就医**：',
      '- 呼吸困难或胸痛',
      '- 意识模糊或昏迷',
      '- 严重出血',
      '- 高热（>39°C）持续不退',
      '- 突发剧烈头痛',
    ].filter(Boolean)

    return medSuccess(lines.join('\n'), { analysis: result })
  } catch (err) {
    return medError(`Symptom analysis error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function reportInterpret(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const reportText = args.report_text as string | undefined
  const reportPath = args.report_path as string | undefined
  const reportType = (args.report_type as string) || 'other'
  const language = (args.language as string) || 'zh'

  if (!reportText && !reportPath) return medError('report_text or report_path is required')

  try {
    let text = reportText || ''
    if (reportPath && !reportText) {
      try {
        const { api } = await import('@services/electronBridge')
        const content = await api.file.read(reportPath)
        text = typeof content === 'string' ? content : String(content)
      } catch {
        return medError(`Failed to read report file: ${reportPath}`)
      }
    }

    const typeNames: Record<string, string> = {
      blood_test: '血液检查',
      imaging: '影像学检查',
      pathology: '病理报告',
      physical_exam: '体检报告',
      other: '其他报告',
    }

    const result: Partial<ReportInterpretation> = {
      reportId: `report_${Date.now()}`,
      summary: '',
      summaryZh: '',
      abnormalValues: [],
      criticalValues: [],
      possibleCauses: [],
      followUpQuestions: [],
      disclaimer: 'This interpretation is for reference only. Please consult your healthcare provider for professional interpretation.',
    }

    const lines = [
      `**医学报告解读**${MEDICAL_DISCLAIMER}`,
      '',
      `📄 **报告类型**: ${typeNames[reportType] || reportType}`,
      `${statusIcon('normal')} **初步状态**: 待专业解读`,
      `📊 **内容长度**: ${text.length} 字符`,
      `🌐 **语言**: ${language === 'zh' ? '中文' : 'English'}`,
      '',
      '---',
      '',
      '### 📋 解读说明',
      '',
      '本工具将按以下结构解读报告：',
      '1. **摘要** — 报告核心发现的通俗解释',
      '2. **异常值** — 超出参考范围的指标及可能含义',
      '3. **危急值** — 需要立即关注的异常指标',
      '4. **可能原因** — 异常结果的常见原因分析',
      '5. **随访建议** — 建议向医生提出的问题',
      '',
      '> ⚠️ 报告解读仅供参考，请以医生的专业解读为准。',
    ]

    return medSuccess(lines.join('\n'), { interpretation: result, textLength: text.length })
  } catch (err) {
    return medError(`Report interpretation error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function drugLookup(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const drugName = args.drug_name as string
  const includeInteractions = args.include_interactions !== false
  const includeSideEffects = args.include_side_effects !== false
  const checkWith = args.check_with as string[] | undefined

  if (!drugName?.trim()) return medError('drug_name is required')

  try {
    const result: Partial<DrugInfo> = {
      id: `drug_${Date.now()}`,
      name: drugName.trim(),
      nameZh: drugName.trim(),
      genericName: '',
      genericNameZh: '',
      category: 'prescription',
      mechanismOfAction: '',
      indications: [],
      contraindications: [],
      sideEffects: [],
      interactions: [],
      dosageForms: [],
      evidenceLevel: 'moderate',
    }

    const lines = [
      `**药物信息查询**${MEDICAL_DISCLAIMER}`,
      '',
      `💊 **药物名称**: ${drugName.trim()}`,
      `${checkWith?.length ? `🔍 **交互检查**: 与 ${checkWith.join(', ')} 的相互作用` : ''}`,
      '',
      '---',
      '',
      '### 💊 药物信息说明',
      '',
      '本工具将提供以下药物信息：',
      '- **通用名与分类** — 药物类别与通用名称',
      '- **作用机制** — 药物如何发挥作用',
      '- **适应症** — 批准的用途',
      '- **禁忌症** — 不应使用的情况',
      `${includeSideEffects ? '- **副作用** — 常见与严重不良反应' : ''}`,
      `${includeInteractions ? '- **药物相互作用** — 与其他药物的交互影响' : ''}`,
      '- **剂型** — 可用的药物剂型',
      '',
      '> ⚠️ 药物信息仅供参考，用药请遵医嘱。',
    ].filter(Boolean)

    return medSuccess(lines.join('\n'), { drug: result })
  } catch (err) {
    return medError(`Drug lookup error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function guidelineSearch(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const condition = args.condition as string
  const source = (args.source as string) || 'any'
  const yearFrom = (args.year_from as number) || 2018

  if (!condition?.trim()) return medError('condition is required')

  const sourceNames: Record<string, string> = {
    who: 'WHO (世界卫生组织)',
    cdc: 'CDC (美国疾控中心)',
    nih: 'NIH (美国国立卫生研究院)',
    nice: 'NICE (英国国家卫生与临床优化研究所)',
    cma: 'CMA (中华医学会)',
    any: '所有来源',
  }

  try {
    const result: Partial<ClinicalGuideline> = {
      id: `guideline_${Date.now()}`,
      title: `Clinical Guidelines for ${condition.trim()}`,
      titleZh: `${condition.trim()} 临床指南`,
      source: source as ClinicalGuideline['source'],
      year: new Date().getFullYear(),
      condition: condition.trim(),
      conditionZh: condition.trim(),
      recommendations: [],
    }

    const lines = [
      `**临床指南搜索**${MEDICAL_DISCLAIMER}`,
      '',
      `🏥 **疾病/主题**: ${condition.trim()}`,
      `📚 **来源**: ${sourceNames[source] || source}`,
      `📅 **起始年份**: ${yearFrom}`,
      '',
      '---',
      '',
      '### 📖 指南搜索说明',
      '',
      '本工具将搜索权威临床实践指南，包括：',
      '- **推荐等级** — A/B/C/D 级推荐',
      '- **证据等级** — 强/中/有限/不足',
      '- **来源** — 发布机构与年份',
      '- **链接** — 原始指南文档',
      '',
      '### 📊 推荐等级说明',
      '',
      '| 等级 | 含义 | 证据基础 |',
      '| --- | --- | --- |',
      '| A | 强推荐 | 高质量证据 |',
      '| B | 推荐 | 中等质量证据 |',
      '| C | 弱推荐 | 低质量证据 |',
      '| D | 仅专家意见 | 极低质量证据 |',
      '',
      '> ⚠️ 临床指南仅供参考，具体诊疗方案应由医生根据患者情况制定。',
    ]

    return medSuccess(lines.join('\n'), { guideline: result })
  } catch (err) {
    return medError(`Guideline search error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function healthAssessmentTool(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const age = args.age as number | undefined
  const gender = args.gender as string | undefined
  const lifestyle = args.lifestyle as Record<string, unknown> | undefined
  const familyHistory = args.family_history as string[] | undefined
  const existingConditions = args.existing_conditions as string[] | undefined

  try {
    const result: Partial<HealthAssessment> = {
      id: `health_${Date.now()}`,
      category: 'general',
      categoryZh: '综合健康评估',
      riskLevel: 'moderate',
      factors: [],
      recommendations: [],
      evidenceLevel: 'moderate',
    }

    const lines = [
      `**健康风险评估**${MEDICAL_DISCLAIMER}`,
      '',
      `${age ? `👤 **年龄**: ${age}岁` : ''}`,
      `${gender ? `⚧ **性别**: ${gender}` : ''}`,
      '',
      '---',
      '',
      '### 📊 评估维度',
      '',
      '本工具将从以下维度进行健康风险评估：',
      '',
      '| 维度 | 评估内容 |',
      '| --- | --- |',
      '| 🫀 心血管风险 | 血压、血脂、吸烟、运动 |',
      '| 🫁 呼吸系统 | 吸烟、空气质量、职业暴露 |',
      '| 🧠 神经精神 | 压力、睡眠、认知功能 |',
      '| 🦴 骨骼肌肉 | 运动、钙摄入、年龄 |',
      '| 🧬 肿瘤风险 | 家族史、生活方式、年龄 |',
      '| 🩸 代谢风险 | BMI、血糖、饮食 |',
    ].filter(Boolean)

    if (lifestyle) {
      lines.push('', '### 🏃 生活方式因素')
      const lifestyleMap: Record<string, string> = {
        smoking: '吸烟',
        alcohol: '饮酒',
        exercise: '运动',
        diet: '饮食',
        sleep: '睡眠',
      }
      for (const [key, label] of Object.entries(lifestyleMap)) {
        if (lifestyle[key] !== undefined) {
          lines.push(`- **${label}**: ${lifestyle[key]}`)
        }
      }
    }

    if (familyHistory?.length) {
      lines.push('', '### 🧬 家族病史', ...familyHistory.map(h => `- ${h}`))
    }

    if (existingConditions?.length) {
      lines.push('', '### 🏥 现有疾病', ...existingConditions.map(c => `- ${c}`))
    }

    lines.push(
      '',
      '> ⚠️ 健康评估结果仅供参考，不替代专业医疗评估。请定期进行体检并咨询医生。',
    )

    return medSuccess(lines.join('\n'), { assessment: result })
  } catch (err) {
    return medError(`Health assessment error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function literatureReviewSearch(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const query = args.query as string
  const maxResults = Math.min((args.max_results as number) || 10, 30)
  const yearFrom = (args.year_from as number) || 2019
  const studyType = (args.study_type as string) || 'any'

  if (!query?.trim()) return medError('query is required')

  const studyTypeNames: Record<string, string> = {
    rct: '随机对照试验 (RCT)',
    meta_analysis: '荟萃分析',
    systematic_review: '系统综述',
    observational: '观察性研究',
    any: '所有类型',
  }

  try {
    const result: Partial<LiteratureReview> = {
      id: `lit_${Date.now()}`,
      query: query.trim(),
      articles: [],
      summary: '',
      disclaimer: 'This literature review is for reference only and should not replace clinical judgment.',
      searchedAt: Date.now(),
    }

    const lines = [
      `**医学文献综述**${MEDICAL_DISCLAIMER}`,
      '',
      `🔍 **研究问题**: ${query.trim()}`,
      `📊 **最大结果数**: ${maxResults}`,
      `📅 **起始年份**: ${yearFrom}`,
      `📋 **研究类型**: ${studyTypeNames[studyType] || studyType}`,
      '',
      '---',
      '',
      '### 📚 文献搜索说明',
      '',
      '本工具将搜索医学文献数据库，返回：',
      '- **文章标题** — 研究标题',
      '- **作者与期刊** — 发表信息',
      '- **摘要** — 研究摘要',
      '- **相关性评分** — 与查询的相关程度',
      '- **DOI** — 数字对象标识符',
      '',
      '### 📊 证据等级',
      '',
      `${evidenceIcon('strong')} **强证据** — 高质量 RCT、系统综述`,
      `${evidenceIcon('moderate')} **中等证据** — 队列研究、病例对照`,
      `${evidenceIcon('limited')} **有限证据** — 病例报告、专家意见`,
      `${evidenceIcon('insufficient')} **证据不足** — 仅有理论依据`,
      '',
      '> ⚠️ 文献综述仅供参考，临床决策应结合患者具体情况和专业判断。',
    ]

    return medSuccess(lines.join('\n'), { review: result })
  } catch (err) {
    return medError(`Literature review error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const medicalExecutors = {
  symptom_analysis: symptomAnalysis,
  report_interpret: reportInterpret,
  drug_lookup: drugLookup,
  guideline_search: guidelineSearch,
  health_assessment: healthAssessmentTool,
  literature_review: literatureReviewSearch,
}
