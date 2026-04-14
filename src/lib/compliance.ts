import type { ComplianceDocumentType, Stylist } from '@/types'

export type ComplianceStatus = 'green' | 'amber' | 'red' | 'none'

const REQUIRED_TYPES: ComplianceDocumentType[] = ['license', 'insurance']

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T00:00:00')
  if (Number.isNaN(target.getTime())) return null
  return Math.floor((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

type ComplianceDocLike = {
  documentType: string
  expiresAt: string | null
  verified: boolean
}

export function computeComplianceStatus(
  stylist: Pick<Stylist, 'licenseExpiresAt' | 'insuranceVerified' | 'insuranceExpiresAt'>,
  docs: ComplianceDocLike[]
): ComplianceStatus {
  if (docs.length === 0 && !stylist.licenseExpiresAt && !stylist.insuranceExpiresAt) {
    return 'none'
  }

  const byType = new Map<ComplianceDocumentType, typeof docs[number][]>()
  for (const d of docs) {
    const t = d.documentType as ComplianceDocumentType
    if (!byType.has(t)) byType.set(t, [])
    byType.get(t)!.push(d)
  }

  let hasExpired = false
  let missingRequired = false
  let expiringSoon60 = false
  let expiringSoon30 = false
  let hasUnverified = docs.some((d) => !d.verified)

  for (const type of REQUIRED_TYPES) {
    const typeDocs = byType.get(type) ?? []
    const verified = typeDocs.filter((d) => d.verified)
    if (verified.length === 0) {
      missingRequired = true
    }
    for (const d of verified) {
      const days = daysUntil(d.expiresAt)
      if (days === null) continue
      if (days < 0) hasExpired = true
      else if (days <= 30) expiringSoon30 = true
      else if (days <= 60) expiringSoon60 = true
    }
  }

  const licenseDays = daysUntil(stylist.licenseExpiresAt)
  if (licenseDays !== null) {
    if (licenseDays < 0) hasExpired = true
    else if (licenseDays <= 30) expiringSoon30 = true
    else if (licenseDays <= 60) expiringSoon60 = true
  }
  const insuranceDays = daysUntil(stylist.insuranceExpiresAt)
  if (insuranceDays !== null) {
    if (insuranceDays < 0) hasExpired = true
    else if (insuranceDays <= 30) expiringSoon30 = true
    else if (insuranceDays <= 60) expiringSoon60 = true
  }

  if (hasExpired || missingRequired) return 'red'
  if (expiringSoon30 || expiringSoon60 || hasUnverified) return 'amber'
  return 'green'
}

export function complianceStatusLabel(status: ComplianceStatus): string {
  switch (status) {
    case 'green': return 'Compliant'
    case 'amber': return 'Action needed soon'
    case 'red': return 'Non-compliant — expired or missing'
    case 'none': return 'No documents on file'
  }
}
