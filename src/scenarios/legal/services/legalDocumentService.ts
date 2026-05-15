import { api } from '@services/electronBridge'
import type { ContractMetadata, Jurisdiction } from '../providerTypes'

export async function saveContractMetadata(meta: ContractMetadata): Promise<{ success: boolean; error?: string }> {
  try {
    await api.file.write(
      `.legal/contracts/${meta.id}.json`,
      JSON.stringify(meta, null, 2)
    )
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function loadContractMetadata(contractId: string): Promise<ContractMetadata | null> {
  try {
    const content = await api.file.read(`.legal/contracts/${contractId}.json`)
    return JSON.parse(typeof content === 'string' ? content : String(content)) as ContractMetadata
  } catch {
    return null
  }
}

export async function listContracts(): Promise<ContractMetadata[]> {
  try {
    const files = await api.file.readDir('.legal/contracts')
    const contracts: ContractMetadata[] = []
    for (const file of files) {
      if (String(file).endsWith('.json')) {
        const id = String(file).replace('.json', '')
        const meta = await loadContractMetadata(id)
        if (meta) contracts.push(meta)
      }
    }
    return contracts.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export async function saveComplianceReport(report: { id: string; framework: string; data: unknown }): Promise<{ success: boolean }> {
  try {
    await api.file.write(
      `.legal/compliance/${report.id}.json`,
      JSON.stringify(report, null, 2)
    )
    return { success: true }
  } catch {
    return { success: false }
  }
}

export async function getJurisdictionLabel(jurisdiction: Jurisdiction): Promise<string> {
  const labels: Record<Jurisdiction, string> = {
    cn: '中国大陆',
    us: '美国',
    eu: '欧盟',
    uk: '英国',
    jp: '日本',
    other: '其他',
  }
  return labels[jurisdiction] || jurisdiction
}
