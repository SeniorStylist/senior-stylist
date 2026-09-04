// Intuit OAuth callback. Exchanges the code, stores the tokens ONCE per realm
// (qb_connections), then attaches the facilities the validated scope resolves
// to. A second connect for an already-connected realm simply re-activates it
// (fresh tokens) and attaches any additional facilities.

import { db } from '@/db'
import { oauthStates } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { exchangeQBCode, qbGet, qbRedirectUri } from '@/lib/quickbooks'
import { isFranchiseAdmin } from '@/lib/get-facility-id'
import {
  attachFacilities,
  facilityIdsForScope,
  saveConnection,
  setCompanyName,
  type ConnectScope,
} from '@/lib/qb-connection'

const STATE_TTL_MS = 10 * 60 * 1000

interface StatePayload {
  n: string
  s?: ConnectScope
  r?: 'settings' | 'franchise' | 'master'
}

function parseState(raw: string): StatePayload | null {
  // New format: base64url JSON. Legacy format: base64 of the bare nonce.
  try {
    const json = JSON.parse(Buffer.from(raw, 'base64url').toString()) as StatePayload
    if (json && typeof json.n === 'string') return json
  } catch {
    /* fall through */
  }
  const nonce = Buffer.from(raw, 'base64').toString()
  return nonce ? { n: nonce } : null
}

function landing(returnTo: StatePayload['r'], qs: string): string {
  if (returnTo === 'master') return `/master-admin/quickbooks?${qs}`
  if (returnTo === 'franchise') return `/franchise?${qs}`
  return `/settings?section=billing&${qs}`
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const realmId = searchParams.get('realmId')
  let returnTo: StatePayload['r'] = 'settings'

  try {
    if (!code || !state || !realmId) throw new Error('Missing code, state, or realmId')
    if (!/^\d{1,30}$/.test(realmId)) throw new Error('Invalid realmId')

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.redirect(new URL('/login', origin))

    const payload = parseState(state)
    if (!payload) throw new Error('Invalid state')
    const nonce = payload.n
    const scope: ConnectScope = payload.s === 'all' || payload.s === 'franchise' ? payload.s : 'facility'
    returnTo = payload.r === 'master' || payload.r === 'franchise' ? payload.r : 'settings'

    const stateRow = await db.query.oauthStates.findFirst({
      where: eq(oauthStates.nonce, nonce),
    })
    if (!stateRow) throw new Error('Unknown or already-used state')
    if (stateRow.userId !== user.id) throw new Error('State user mismatch')
    if (stateRow.createdAt && Date.now() - stateRow.createdAt.getTime() > STATE_TTL_MS) {
      await db.delete(oauthStates).where(eq(oauthStates.nonce, nonce))
      throw new Error('State expired')
    }
    // Consume the state BEFORE the exchange (one-time use, even if the exchange fails).
    await db.delete(oauthStates).where(eq(oauthStates.nonce, nonce))

    // Re-validate the scope against the caller's real role — the state is
    // attacker-visible in the URL, so the connect route's check isn't enough.
    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (scope === 'all' && !isMaster) throw new Error('Forbidden scope')
    if (scope === 'franchise' && !isMaster && !(await isFranchiseAdmin(user.id))) {
      throw new Error('Forbidden scope')
    }
    if (scope !== 'all' && !stateRow.facilityId) throw new Error('State missing facility id')

    // Must byte-match the redirect_uri sent on the authorize URL — use the
    // same canonical qbRedirectUri(), never this request's origin.
    const tokens = await exchangeQBCode(code, qbRedirectUri())
    await saveConnection({ realmId, tokens, userId: user.id })

    const targetIds = await facilityIdsForScope(scope, stateRow.facilityId ?? null)
    const result = await attachFacilities(realmId, targetIds)

    // Company name for the UI — best-effort, via the first attached facility.
    const probeFacility = result.attached[0] ?? result.alreadyAttached[0] ?? null
    if (probeFacility) {
      try {
        const info = await qbGet<{ CompanyInfo?: { CompanyName?: string } }>(
          probeFacility,
          `/companyinfo/${realmId}?minorversion=75`,
        )
        if (info.CompanyInfo?.CompanyName) await setCompanyName(realmId, info.CompanyInfo.CompanyName)
      } catch (err) {
        console.error('QuickBooks companyinfo probe failed (non-fatal):', err)
      }
    }

    revalidateTag('facilities', { expire: 0 })
    revalidateTag('billing', { expire: 0 })
    const qs = new URLSearchParams({
      qb: 'connected',
      attached: String(result.attached.length + result.alreadyAttached.length),
      ...(result.skipped.length ? { skipped: String(result.skipped.length) } : {}),
    })
    return NextResponse.redirect(new URL(landing(returnTo, qs.toString()), origin))
  } catch (err) {
    console.error('QuickBooks callback error:', err)
    const reason = encodeURIComponent((err as Error).message?.slice(0, 80) ?? 'unknown')
    return NextResponse.redirect(new URL(landing(returnTo, `qb=error&reason=${reason}`), origin))
  }
}
