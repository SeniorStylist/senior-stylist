// Pure heuristic parser for check memos that list per-resident amounts, e.g.
// "Payment for 05/26/26 Jean Hall $48 Alma Markley $48 Portia Cook $48 Harry Evans"
// No DB access, no Gemini — the memo-match preview modal is the safety net for
// parse errors, so a wrong split is harmless (the operator just unchecks it).

export interface ParsedMemoLine {
  rawName: string
  amountCents: number | null
}

export interface ParsedMemo {
  serviceDate: string | null // YYYY-MM-DD
  lines: ParsedMemoLine[]
}

const DATE_RE = /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/
const AMOUNT_RE = /\$\s?(\d{1,6}(?:\.\d{1,2})?)/g
const LEAD_NOISE_RE = /^(payment|pmt|pay|for|of|to|the|re|inv|invoice|svc|services?|check|chk|and|&|[\d#.,;:()-]+)\s+/i

function toCents(s: string): number {
  const [d, c = ''] = s.split('.')
  return parseInt(d, 10) * 100 + (c ? parseInt(c.padEnd(2, '0').slice(0, 2), 10) : 0)
}

function dateToIso(m: RegExpMatchArray): string | null {
  const mm = parseInt(m[1], 10)
  const dd = parseInt(m[2], 10)
  let yy = parseInt(m[3], 10)
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  if (yy < 100) yy += 2000
  if (yy < 2000 || yy > 2100) return null
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

// Reduce a between-amounts text segment to a plausible person name (2–4 alpha
// words). Returns null when the segment doesn't look like a name.
function extractName(segment: string): string | null {
  let s = segment.replace(DATE_RE, ' ')
  // strip leading noise words repeatedly ("Payment for", "for services", ...)
  for (let i = 0; i < 6; i++) {
    const next = s.trimStart().replace(LEAD_NOISE_RE, '')
    if (next === s.trimStart()) break
    s = next
  }
  const words = s
    .split(/[\s,;/&+]+/)
    .map((w) => w.replace(/[^A-Za-z.'-]/g, ''))
    .filter((w) => /[A-Za-z]{2,}/.test(w))
  if (words.length < 2 || words.length > 4) return null
  return words.join(' ')
}

export function parseMemo(memo: string, totalCents: number): ParsedMemo {
  const dateMatch = memo.match(DATE_RE)
  const serviceDate = dateMatch ? dateToIso(dateMatch) : null

  // Locate every $amount and the text segments around them.
  const amounts: Array<{ cents: number; start: number; end: number }> = []
  for (const m of memo.matchAll(AMOUNT_RE)) {
    amounts.push({ cents: toCents(m[1]), start: m.index!, end: m.index! + m[0].length })
  }
  if (amounts.length === 0) return { serviceDate, lines: [] }

  const segments: Array<{ text: string; start: number }> = []
  let cursor = 0
  for (const a of amounts) {
    segments.push({ text: memo.slice(cursor, a.start), start: cursor })
    cursor = a.end
  }
  segments.push({ text: memo.slice(cursor), start: cursor }) // trailing segment

  // Ordering: "Jean Hall $48" (name precedes its amount) vs "$48 Jean Hall".
  // If the text before the first amount contains a name, treat names as
  // preceding their amounts; otherwise names follow.
  const namesPrecede = extractName(segments[0].text) !== null

  const lines: ParsedMemoLine[] = []
  if (namesPrecede) {
    // segment[i] is the name for amounts[i]; the trailing segment (if a name)
    // has no amount of its own.
    for (let i = 0; i < amounts.length; i++) {
      const name = extractName(segments[i].text)
      if (name) lines.push({ rawName: name, amountCents: amounts[i].cents })
    }
    const trailing = extractName(segments[amounts.length].text)
    if (trailing) lines.push({ rawName: trailing, amountCents: null })
  } else {
    // amounts[i] is followed by its name in segment[i+1]
    for (let i = 0; i < amounts.length; i++) {
      const name = extractName(segments[i + 1].text)
      if (name) lines.push({ rawName: name, amountCents: amounts[i].cents })
    }
  }

  // A single trailing no-amount name absorbs the remainder when it's positive.
  const noAmount = lines.filter((l) => l.amountCents === null)
  if (noAmount.length === 1) {
    const sum = lines.reduce((s, l) => s + (l.amountCents ?? 0), 0)
    const remainder = totalCents - sum
    if (remainder > 0) noAmount[0].amountCents = remainder
  }

  return { serviceDate, lines }
}
