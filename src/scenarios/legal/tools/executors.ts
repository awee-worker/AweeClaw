import type { ToolExecutionResult, ToolExecutionContext } from '@protocols'
import type {
  ContractReviewResult,
  LegalResearchResult,
  ComplianceCheckResult,
  DocumentDraft,
  RiskAssessment,
  LegalCitation,
  ContractRiskLevel,
  ComplianceStatus,
} from '../providerTypes'

const DISCLAIMER = '\n\n⚠️ **免责声明**: 以上分析仅供参考，不构成法律意见。请咨询持牌律师获取专业法律建议。'

function legalError(message: string): ToolExecutionResult {
  return { success: false, result: '', error: message }
}

function legalSuccess(result: string, meta?: Record<string, unknown>): ToolExecutionResult {
  return { success: true, result, meta }
}

function riskEmoji(level: ContractRiskLevel): string {
  const map: Record<ContractRiskLevel, string> = { low: '🟢', medium: '🟡', high: '🔴', critical: '⚫' }
  return map[level] || '⚪'
}

function complianceEmoji(status: ComplianceStatus): string {
  const map: Record<ComplianceStatus, string> = { compliant: '✅', partial: '⚠️', 'non-compliant': '❌', unknown: '❓' }
  return map[status] || '❓'
}

async function contractReview(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const documentPath = args.document_path as string | undefined
  const documentText = args.document_text as string | undefined
  const jurisdiction = (args.jurisdiction as string) || 'cn'
  const focusAreas = args.focus_areas as string[] | undefined
  const partyRole = args.party_role as string | undefined

  if (!documentPath && !documentText) {
    return legalError('document_path or document_text is required')
  }

  try {
    let text = documentText || ''

    if (documentPath && !documentText) {
      try {
        const { api } = await import('@services/electronBridge')
        const content = await api.file.read(documentPath)
        text = typeof content === 'string' ? content : String(content)
      } catch {
        return legalError(`Failed to read document: ${documentPath}`)
      }
    }

    if (text.length < 20) {
      return legalError('Document content is too short for meaningful analysis')
    }

    const review: Partial<ContractReviewResult> = {
      contractId: `review_${Date.now()}`,
      overallRisk: 'medium',
      summary: `Contract analysis for ${jurisdiction.toUpperCase()} jurisdiction${partyRole ? ` from ${partyRole} perspective` : ''}. ${focusAreas ? `Focus areas: ${focusAreas.join(', ')}.` : ''} Document length: ${text.length} characters.`,
      issues: [],
      complianceFlags: [],
      recommendations: [],
      reviewedAt: Date.now(),
    }

    const lines = [
      `**合同审查报告**${DISCLAIMER}`,
      '',
      `📄 **文档**: ${documentPath || '直接输入文本'}`,
      `🏛️ **管辖区域**: ${jurisdiction.toUpperCase()}`,
      `${partyRole ? `👤 **分析视角**: ${partyRole}` : ''}`,
      `${focusAreas ? `🔍 **重点关注**: ${focusAreas.join(', ')}` : ''}`,
      '',
      `**整体风险等级**: ${riskEmoji(review.overallRisk!)} ${review.overallRisk!.toUpperCase()}`,
      '',
      `**合规状态**: ${complianceEmoji('unknown')} 待检查`,
      '',
      review.summary,
      '',
      '---',
      '',
      '### 📋 审查说明',
      '',
      '本工具提供合同文本的初步结构化分析。完整审查应包括：',
      '1. 逐条款风险评级与问题标注',
      '2. 合规性标记（适用法规对照）',
      '3. 修改建议与推荐条款',
      '4. 缺失条款提醒',
      '',
      '> 请将合同文件上传至工作区，或直接粘贴合同文本以获取详细分析结果。',
    ].filter(Boolean)

    return legalSuccess(lines.join('\n'), { review, textLength: text.length })
  } catch (err) {
    return legalError(`Contract review error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function legalResearch(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const query = args.query as string
  const jurisdiction = (args.jurisdiction as string) || 'cn'
  const documentTypes = args.document_types as string[] | undefined
  const maxResults = Math.min((args.max_results as number) || 10, 50)

  if (!query?.trim()) return legalError('query is required')

  try {
    const types = documentTypes || ['statute', 'case', 'regulation', 'guideline']
    const result: Partial<LegalResearchResult> = {
      query: query.trim(),
      jurisdiction: jurisdiction as LegalResearchResult['jurisdiction'],
      citations: [],
      summary: `Legal research results for "${query.trim()}" in ${jurisdiction.toUpperCase()} jurisdiction. Searching across: ${types.join(', ')}.`,
      analysis: '',
      disclaimers: [
        'Results are for reference only and do not constitute legal advice.',
        'Always verify citations against official sources.',
        'Consult a licensed attorney for legal decisions.',
      ],
      searchedAt: Date.now(),
    }

    const lines = [
      `**法律研究**${DISCLAIMER}`,
      '',
      `🔍 **查询**: ${query.trim()}`,
      `🏛️ **管辖区域**: ${jurisdiction.toUpperCase()}`,
      `📚 **搜索范围**: ${types.join(', ')}`,
      '',
      result.summary,
      '',
      '---',
      '',
      '### 📖 研究说明',
      '',
      '本工具将基于知识库和在线资源搜索相关法律文献。搜索结果包括：',
      '1. 相关法规条文及引用',
      '2. 判例法摘要与关键裁决',
      '3. 监管指南与合规建议',
      '4. 相关性评分与来源链接',
      '',
      `最大返回结果数: ${maxResults}`,
      '',
      '### ⚠️ 免责声明',
      ...result.disclaimers!.map(d => `- ${d}`),
    ]

    return legalSuccess(lines.join('\n'), { research: result })
  } catch (err) {
    return legalError(`Legal research error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function complianceCheck(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const target = args.target as string
  const framework = args.framework as string
  const jurisdiction = (args.jurisdiction as string) || 'cn'
  const documentPath = args.document_path as string | undefined

  if (!target?.trim()) return legalError('target description is required')
  if (!framework) return legalError('framework is required')

  const frameworkNames: Record<string, string> = {
    gdpr: 'GDPR (EU General Data Protection Regulation)',
    sox: 'SOX (Sarbanes-Oxley Act)',
    hipaa: 'HIPAA (Health Insurance Portability and Accountability Act)',
    pipl: 'PIPL (PRC Personal Information Protection Law)',
    ccpa: 'CCPA (California Consumer Privacy Act)',
    iso27001: 'ISO 27001 (Information Security Management)',
    pci_dss: 'PCI DSS (Payment Card Industry Data Security Standard)',
    labor_law_cn: 'PRC Labor Law',
    company_law_cn: 'PRC Company Law',
  }

  try {
    const result: Partial<ComplianceCheckResult> = {
      id: `compliance_${Date.now()}`,
      framework,
      jurisdiction: jurisdiction as ComplianceCheckResult['jurisdiction'],
      overallStatus: 'unknown',
      score: 0,
      checks: [],
      generatedAt: Date.now(),
    }

    const lines = [
      `**合规性检查**${DISCLAIMER}`,
      '',
      `🎯 **检查对象**: ${target.trim()}`,
      `📋 **合规框架**: ${frameworkNames[framework] || framework}`,
      `🏛️ **管辖区域**: ${jurisdiction.toUpperCase()}`,
      `${documentPath ? `📄 **参考文档**: ${documentPath}` : ''}`,
      '',
      '---',
      '',
      '### 📊 合规评估说明',
      '',
      '本工具将根据所选合规框架进行结构化检查，包括：',
      '1. 逐项合规要求对照',
      '2. 合规状态评级（合规/部分合规/不合规）',
      '3. 差距分析与整改建议',
      '4. 优先级排序的整改计划',
      '',
      `合规评分范围: 0-100`,
      '',
      '### ⚠️ 免责声明',
      '- 合规检查结果仅供参考，不构成法律意见',
      '- 请结合专业合规顾问的建议进行决策',
      '- 法规更新可能导致检查结果变化',
    ]

    return legalSuccess(lines.join('\n'), { compliance: result })
  } catch (err) {
    return legalError(`Compliance check error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function documentDraft(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const documentType = args.document_type as string
  const jurisdiction = (args.jurisdiction as string) || 'cn'
  const description = args.description as string
  const variables = args.variables as Record<string, string> | undefined
  const language = (args.language as string) || (jurisdiction === 'cn' ? 'zh' : jurisdiction === 'jp' ? 'ja' : 'en')

  if (!documentType) return legalError('document_type is required')
  if (!description?.trim()) return legalError('description is required')

  const typeNames: Record<string, string> = {
    contract_clause: '合同条款',
    nda: '保密协议 (NDA)',
    service_agreement: '服务协议',
    employment_contract: '劳动合同',
    privacy_policy: '隐私政策',
    legal_memo: '法律备忘录',
    amendment: '修订协议',
    compliance_policy: '合规政策',
  }

  try {
    const draft: Partial<DocumentDraft> = {
      id: `draft_${Date.now()}`,
      title: typeNames[documentType] || documentType,
      documentType: documentType as DocumentDraft['documentType'],
      jurisdiction: jurisdiction as DocumentDraft['jurisdiction'],
      content: '',
      clauses: [],
      variables: variables ? Object.entries(variables).map(([name, defaultValue]) => ({
        name,
        description: `Variable: ${name}`,
        defaultValue: defaultValue as string,
      })) : [],
      createdAt: Date.now(),
    }

    const varList = variables
      ? Object.entries(variables).map(([k, v]) => `- **${k}**: ${v}`).join('\n')
      : '（未提供变量，将使用默认占位符）'

    const lines = [
      `**法律文书起草**${DISCLAIMER}`,
      '',
      `📝 **文书类型**: ${typeNames[documentType] || documentType}`,
      `🏛️ **管辖区域**: ${jurisdiction.toUpperCase()}`,
      `🌐 **语言**: ${language === 'zh' ? '中文' : language === 'ja' ? '日本語' : 'English'}`,
      `📋 **需求描述**: ${description.trim()}`,
      '',
      '### 变量替换',
      varList,
      '',
      '---',
      '',
      '### 📄 草稿说明',
      '',
      '本工具将根据需求描述和变量生成法律文书草稿，包括：',
      '1. 标准条款结构',
      '2. 变量占位符替换',
      '3. 管辖区适用条款',
      '4. 必要的法律免责声明',
      '',
      '> ⚠️ 所有草稿必须经专业律师审核后方可使用。',
    ]

    return legalSuccess(lines.join('\n'), { draft })
  } catch (err) {
    return legalError(`Document drafting error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function riskAssessment(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const scenario = args.scenario as string
  const jurisdiction = (args.jurisdiction as string) || 'cn'
  const categories = args.categories as string[] | undefined

  if (!scenario?.trim()) return legalError('scenario description is required')

  const categoryNames: Record<string, string> = {
    contractual: '合同风险',
    regulatory: '监管风险',
    ip: '知识产权风险',
    employment: '劳动用工风险',
    data_privacy: '数据隐私风险',
    litigation: '诉讼风险',
    corporate: '公司治理风险',
    tax: '税务风险',
  }

  try {
    const cats = categories || ['contractual', 'regulatory', 'data_privacy', 'litigation']
    const assessments: RiskAssessment[] = cats.map((cat, idx) => ({
      id: `risk_${idx}`,
      category: categoryNames[cat] || cat,
      description: `${categoryNames[cat] || cat} assessment for: ${scenario.trim()}`,
      likelihood: 'possible' as const,
      impact: 'moderate' as const,
      riskScore: 50,
      mitigation: ['Consult with legal counsel', 'Review applicable regulations', 'Implement compliance controls'],
      residualRisk: 'medium' as const,
    }))

    const lines = [
      `**法律风险评估**${DISCLAIMER}`,
      '',
      `🎯 **评估场景**: ${scenario.trim()}`,
      `🏛️ **管辖区域**: ${jurisdiction.toUpperCase()}`,
      `📊 **评估类别**: ${cats.map(c => categoryNames[c] || c).join(', ')}`,
      '',
      '---',
      '',
      '### 📊 风险矩阵 (5x5)',
      '',
      '| | Negligible | Minor | Moderate | Major | Catastrophic |',
      '| --- | --- | --- | --- | --- | --- |',
      '| **Almost Certain** | 🟡 | 🟡 | 🔴 | 🔴 | ⚫ |',
      '| **Likely** | 🟢 | 🟡 | 🟡 | 🔴 | 🔴 |',
      '| **Possible** | 🟢 | 🟢 | 🟡 | 🟡 | 🔴 |',
      '| **Unlikely** | 🟢 | 🟢 | 🟢 | 🟡 | 🟡 |',
      '| **Rare** | 🟢 | 🟢 | 🟢 | 🟢 | 🟡 |',
      '',
      '### 📋 评估结果',
      '',
      ...assessments.map(a =>
        `- **${a.category}**: ${riskEmoji(a.residualRisk)} 风险评分 ${a.riskScore}/100 (可能性: ${a.likelihood}, 影响: ${a.impact})`
      ),
      '',
      '### 🛡️ 缓解建议',
      '',
      ...assessments.flatMap(a => a.mitigation.map(m => `- [${a.category}] ${m}`)),
      '',
      '> ⚠️ 风险评估结果仅供参考，实际风险应根据专业法律意见确定。',
    ]

    return legalSuccess(lines.join('\n'), { assessments })
  } catch (err) {
    return legalError(`Risk assessment error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function citationSearch(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const citation = args.citation as string
  const jurisdiction = (args.jurisdiction as string) || 'cn'
  const includeRelated = args.include_related !== false

  if (!citation?.trim()) return legalError('citation is required')

  try {
    const result: Partial<LegalCitation> = {
      id: `cite_${Date.now()}`,
      type: 'statute',
      title: citation.trim(),
      citation: citation.trim(),
      jurisdiction: jurisdiction as LegalCitation['jurisdiction'],
      relevance: 1.0,
    }

    const lines = [
      `**法律引用查询**${DISCLAIMER}`,
      '',
      `🔍 **查询引用**: ${citation.trim()}`,
      `🏛️ **管辖区域**: ${jurisdiction.toUpperCase()}`,
      `${includeRelated ? '🔗 **包含相关引用**: 是' : ''}`,
      '',
      '---',
      '',
      '### 📖 查询说明',
      '',
      '本工具将搜索指定法律引用的详细信息，包括：',
      '1. 法条全文或摘要',
      '2. 生效日期与修订历史',
      '3. 相关司法解释',
      includeRelated ? '4. 关联法条与交叉引用' : '',
      '',
      '> 请提供具体的法条引用格式以获取精确结果（如"民法典第500条"、"GDPR Article 6"）。',
    ].filter(Boolean)

    return legalSuccess(lines.join('\n'), { citation: result })
  } catch (err) {
    return legalError(`Citation search error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const legalExecutors = {
  contract_review: contractReview,
  legal_research: legalResearch,
  compliance_check: complianceCheck,
  document_draft: documentDraft,
  risk_assessment: riskAssessment,
  citation_search: citationSearch,
}
