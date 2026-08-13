/**
 * P52/P53 — THE resident matcher for family self-signup. Single source of truth:
 * the public match-preview endpoint (POST /api/portal/signup/match) and the
 * final signup POST both call this, so the preview can never promise a match
 * the POST won't re-derive. The wizard never carries a residentId — the server
 * re-matches from the typed name/room on submit.
 *
 * P53 SECURITY REWORK — deliberately does NOT use src/lib/fuzzy.ts here:
 * fuzzyScore's whole-string substring rule ("Smith" ⊂ "Margaret Smith" = 0.85)
 * is right for OCR/payee matching but let a single surname reach the confident
 * tier and even defeat the tier-1.5 POA-name check. All name comparison in the
 * signup domain is word-pair based with NO whole-string containment shortcut.
 *
 * Confidence doctrine: `confident` requires either room agreement + a solid
 * name score, or a MULTI-WORD typed name with a strong strict score and a
 * CLEAR gap to the runner-up — ambiguity always fails closed to the admin
 * queue (and ambiguous matches never stamp a residentId on the claim).
 */

export type SignupRosterResident = {
  id: string
  name: string
  roomNumber: string | null
  poaName: string | null
}

export type SignupMatch = {
  resident: SignupRosterResident
  score: number
  runnerUpScore: number
  roomAgrees: boolean
  /** Top score tied between DIFFERENT residents — never confident, never stamped. */
  ambiguous: boolean
  /** Safe to SHOW to the family (confirm card) / act on (tier 1.5). */
  confident: boolean
}

export function normRoom(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase().replace(/^#/, '')
}

/** Lowercase, strip punctuation, split on whitespace. Order preserved (first/last matter). */
function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Small inline Levenshtein — signup names are short; no dependency. */
function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[n]
}

/**
 * Per-word agreement: exact, a ≥3-char prefix of the other ("rob"/"robert"),
 * or edit-distance similarity ≥0.8 (typos: "margret"/"margaret"). Per-word
 * prefixing is fine; whole-string containment is exactly what we're banning.
 */
function wordSimilar(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length >= 3 && b.startsWith(a)) return true
  if (b.length >= 3 && a.startsWith(b)) return true
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return false
  return 1 - editDistance(a, b) / maxLen >= 0.8
}

/**
 * Strict whole-name score: 1.0 on normalized equality, else the fraction of
 * greedily-paired similar words over max(word counts). "Smith" vs
 * "Margaret Smith" scores 0.5 — a lone surname can never look strong.
 */
export function strictNameScore(a: string, b: string): number {
  const aw = nameWords(a)
  const bw = nameWords(b)
  if (aw.length === 0 || bw.length === 0) return 0
  if (aw.join(' ') === bw.join(' ')) return 1
  const used = new Set<number>()
  let agreed = 0
  for (const w of aw) {
    for (let j = 0; j < bw.length; j++) {
      if (used.has(j)) continue
      if (wordSimilar(w, bw[j])) {
        used.add(j)
        agreed++
        break
      }
    }
  }
  return agreed / Math.max(aw.length, bw.length)
}

/**
 * P53 tier-1.5 comparator: does the applicant's typed name agree with the
 * on-file POA/family-contact name strongly enough to treat as identity?
 * BOTH names must have ≥2 words, and the first AND last words must agree —
 * a single-word poaName ("Smith", "Daughter") can never instant-approve.
 */
export function nameAgreement(typedName: string, poaName: string): boolean {
  const t = nameWords(typedName)
  const p = nameWords(poaName)
  if (t.length < 2 || p.length < 2) return false
  return wordSimilar(t[0], p[0]) && wordSimilar(t[t.length - 1], p[p.length - 1])
}

export function matchResidentForSignup(
  roster: SignupRosterResident[],
  residentName: string | null | undefined,
  roomNumber: string | null | undefined,
): SignupMatch | null {
  const claimed = residentName?.trim() ?? ''
  if (claimed.length < 2) return null
  const claimedRoom = normRoom(roomNumber)
  const multiWord = nameWords(claimed).length >= 2

  // Score every candidate and compute room agreement PER CANDIDATE, then rank
  // by (roomAgrees desc, score desc) — a room-agreeing "Mary Smith" always
  // beats the other "Mary Smith" in a different room.
  const scored = roster.map((r) => ({
    resident: r,
    score: strictNameScore(claimed, r.name),
    roomAgrees: claimedRoom !== '' && normRoom(r.roomNumber) === claimedRoom,
  }))
  scored.sort((x, y) =>
    x.roomAgrees !== y.roomAgrees ? (x.roomAgrees ? -1 : 1) : y.score - x.score,
  )

  const best = scored[0]
  if (!best || best.score <= 0.74) return null

  const runnerUp = scored.find((c) => c.resident.id !== best.resident.id)
  const runnerUpScore = runnerUp?.score ?? 0
  // Exact top-score tie between different residents with the same room signal
  // → genuinely can't tell them apart. Fail closed.
  const ambiguous =
    !!runnerUp && runnerUp.score === best.score && runnerUp.roomAgrees === best.roomAgrees

  const confident =
    !ambiguous &&
    ((best.roomAgrees && best.score >= 0.75) ||
      (multiWord && best.score >= 0.85 && runnerUpScore < 0.7))

  return {
    resident: best.resident,
    score: best.score,
    runnerUpScore,
    roomAgrees: best.roomAgrees,
    ambiguous,
    confident,
  }
}
