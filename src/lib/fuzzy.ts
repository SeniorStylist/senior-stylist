export const WORD_EXPANSIONS: Record<string, string> = {
  w: 'wash',
  c: 'cut',
  hl: 'highlight',
  clr: 'color',
}

export const STOP_WORDS = new Set([
  'llc', 'inc', 'corp', 'dba', 'snf', 'rfms',
  'petty', 'cash', 'account', 'operating', 'disbursement',
  'at', 'of', 'the', 'and',
])

export function normalizeWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/#/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORD_EXPANSIONS[w] ?? w)
    .filter((w) => !STOP_WORDS.has(w))
    .sort()
}

export function fuzzyMatches<T extends { name: string }>(items: T[], name: string): T[] {
  if (!name) return []
  const q = name.toLowerCase()
  const qWords = normalizeWords(name)

  return items.filter((item) => {
    const iName = item.name.toLowerCase()
    if (iName.includes(q) || q.includes(iName)) return true
    if (qWords.length === 0) return false
    const iWords = normalizeWords(item.name)
    if (iWords.length === 0) return false
    const intersection = qWords.filter((w) => iWords.includes(w))
    const overlapRatio = intersection.length / Math.max(qWords.length, iWords.length)
    return overlapRatio >= 0.8
  })
}

export function fuzzyScore(a: string, b: string): number {
  const al = a.toLowerCase()
  const bl = b.toLowerCase()
  if (al === bl) return 1.0
  if (al.includes(bl) || bl.includes(al)) return 0.85
  const aw = normalizeWords(a)
  const bw = normalizeWords(b)
  if (aw.length === 0 || bw.length === 0) return 0
  const intersection = aw.filter((w) => bw.includes(w))
  return intersection.length / Math.max(aw.length, bw.length)
}

export function fuzzyBestMatch<T extends { name: string }>(
  items: T[],
  name: string,
  minScore = 0.7,
): T | null {
  if (!name) return null
  let best: T | null = null
  let bestScore = minScore - 0.001
  for (const item of items) {
    const score = fuzzyScore(name, item.name)
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  return best
}
