export function buildCategoryPriority(
  order: string[] | null | undefined,
): Record<string, number> {
  if (!order || order.length === 0) return {}
  const map: Record<string, number> = {}
  order.forEach((cat, i) => {
    map[cat] = i
  })
  return map
}

export function sortCategoryGroups<T>(
  groups: Array<[string, T[]]>,
  priority: Record<string, number>,
): Array<[string, T[]]> {
  return [...groups].sort(([a], [b]) => {
    if (a === 'Other') return 1
    if (b === 'Other') return -1
    const pa = priority[a]
    const pb = priority[b]
    const hasA = pa !== undefined
    const hasB = pb !== undefined
    if (hasA && hasB) return pa - pb
    if (hasA) return -1
    if (hasB) return 1
    return b.localeCompare(a)
  })
}

export function sortServicesWithinCategory<T extends { name: string; pricingType: string }>(
  items: T[],
): T[] {
  const priority = (pt: string) => (pt === 'addon' ? 2 : pt === 'tiered' ? 1 : 0)
  return [...items].sort((a, b) => {
    const pa = priority(a.pricingType)
    const pb = priority(b.pricingType)
    if (pa !== pb) return pa - pb
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}
