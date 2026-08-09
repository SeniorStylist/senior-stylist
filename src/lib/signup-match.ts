import { fuzzyScore } from '@/lib/fuzzy'

/**
 * P52 — THE resident matcher for family self-signup. Single source of truth:
 * the public match-preview endpoint (POST /api/portal/signup/match) and the
 * final signup POST both call this, so the preview can never promise a match
 * the POST won't re-derive. The wizard never carries a residentId — the server
 * re-matches from the typed name/room on submit.
 *
 * Confidence doctrine (gift-checkout precedent): `confident` requires either
 * room agreement + a solid name score, or a strong name score with a CLEAR gap
 * to the runner-up — ambiguity always fails closed to the admin queue.
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
  /** Safe to SHOW to the family (confirm card) / act on (tier 1.5). */
  confident: boolean
}

export function normRoom(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase().replace(/^#/, '')
}

export function matchResidentForSignup(
  roster: SignupRosterResident[],
  residentName: string | null | undefined,
  roomNumber: string | null | undefined,
): SignupMatch | null {
  const claimed = residentName?.trim() ?? ''
  if (claimed.length < 2) return null
  const claimedRoom = normRoom(roomNumber)

  let best: { resident: SignupRosterResident; score: number } | null = null
  let runnerUpScore = 0
  for (const r of roster) {
    const score = fuzzyScore(claimed, r.name)
    if (!best || score > best.score) {
      if (best) runnerUpScore = best.score
      best = { resident: r, score }
    } else if (score > runnerUpScore) {
      runnerUpScore = score
    }
  }

  // Floor mirrors the P50 tier-2 threshold (score must EXCEED 0.74).
  if (!best || best.score <= 0.74) return null

  const roomAgrees = claimedRoom !== '' && normRoom(best.resident.roomNumber) === claimedRoom
  const confident =
    (roomAgrees && best.score >= 0.75) || (best.score >= 0.85 && runnerUpScore < 0.7)

  return { resident: best.resident, score: best.score, runnerUpScore, roomAgrees, confident }
}
