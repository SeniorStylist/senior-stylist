import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getAccessToken, markAccessTokenExpired } from '@/lib/qb-connection'
import {
  exchangeQBCode as exchangeQBCodeHttp,
  getQBAuthUrl as getQBAuthUrlHttp,
  qbRedirectUri as qbRedirectUriHttp,
  revokeQBRefreshToken,
  type QBTokens as QBTokensHttp,
} from '@/lib/qb-oauth-http'
import { decryptToken } from '@/lib/token-crypto'
import { createHash } from 'crypto'

const QB_BASE = 'https://quickbooks.api.intuit.com'
/** Intuit deprecated minor versions < 75 (2025-08); 75 is the base now. */
export const QB_MINOR = 75
/** Intuit allows 10 concurrent requests per realm per app — ALL facilities
 *  share one realm, so the cron, mirror worker and operator clicks must
 *  share one in-flight budget per server instance. */
const MAX_IN_FLIGHT_PER_REALM = 5

export type QBTokens = QBTokensHttp

/**
 * Quote a value for the QBO query language. Backslash first, then the
 * apostrophe (Intuit: escape `'` with `\`); control characters stripped. The
 * caller must still pass the whole query through encodeURIComponent (which
 * encodes the backslash as %5C — required, never use encodeURI). An unescaped
 * quote in a resident name would otherwise widen a WHERE across the shared
 * realm (query injection).
 */
export function qbQuoteLiteral(value: string): string {
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, '')
  return `'${cleaned.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * Deterministic Intuit RequestId (≤50 chars, unique per realm) from the parts
 * that identify ONE logical create. Include a per-run component (e.g. the run's
 * startedAt) when the same logical object may legitimately be created again
 * later (an invoice re-pushed after an undo) — otherwise Intuit replays the
 * first response forever.
 */
export function qbRequestId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40)
}

// Per-realm in-flight limiter (per server instance).
const inFlightCount = new Map<string, number>()
const waiters = new Map<string, Array<() => void>>()
async function acquireSlot(realmId: string): Promise<void> {
  while ((inFlightCount.get(realmId) ?? 0) >= MAX_IN_FLIGHT_PER_REALM) {
    await new Promise<void>((resolve) => {
      const list = waiters.get(realmId) ?? []
      list.push(resolve)
      waiters.set(realmId, list)
    })
  }
  inFlightCount.set(realmId, (inFlightCount.get(realmId) ?? 0) + 1)
}
function releaseSlot(realmId: string): void {
  inFlightCount.set(realmId, Math.max(0, (inFlightCount.get(realmId) ?? 1) - 1))
  const next = waiters.get(realmId)?.shift()
  if (next) next()
}
export const qbRedirectUri = qbRedirectUriHttp
export const getQBAuthUrl = getQBAuthUrlHttp
export const exchangeQBCode = exchangeQBCodeHttp

/**
 * Access token for the facility's QuickBooks company. Tokens live once per
 * realm in qb_connections (see qb-connection.ts) — the facility only carries
 * the attachment (facilities.qb_realm_id). Kept under its historic name so
 * every call site keeps working.
 */
export async function refreshQBToken(facilityId: string): Promise<string> {
  const realmId = await getRealmId(facilityId)
  return getAccessToken(realmId)
}

async function getRealmId(facilityId: string): Promise<string> {
  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { qbRealmId: true },
  })
  if (!facility?.qbRealmId) throw new Error('QuickBooks not connected')
  return facility.qbRealmId
}

async function qbFetch<T>(
  facilityId: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  opts?: { octetStream?: boolean; requestId?: string },
): Promise<T> {
  const realmId = await getRealmId(facilityId)
  // Auto-append the minor version + optional Intuit RequestId (server-side
  // idempotency: a retried create with the same id replays the original
  // response instead of creating a twin).
  let fullPath = path
  if (!/[?&]minorversion=/.test(fullPath)) {
    fullPath += `${fullPath.includes('?') ? '&' : '?'}minorversion=${QB_MINOR}`
  }
  if (opts?.requestId) {
    fullPath += `&requestid=${encodeURIComponent(opts.requestId.slice(0, 50))}`
  }
  const url = `${QB_BASE}/v3/company/${realmId}${fullPath}`

  const doCall = async (token: string): Promise<Response> => {
    await acquireSlot(realmId)
    try {
      return await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        // Intuit's send endpoints (/invoice/{id}/send) require
        // application/octet-stream with an empty body — a JSON body 400s.
        ...(opts?.octetStream
          ? { 'Content-Type': 'application/octet-stream' }
          : body
            ? { 'Content-Type': 'application/json' }
            : {}),
      },
        body: body && !opts?.octetStream ? JSON.stringify(body) : undefined,
      })
    } finally {
      releaseSlot(realmId)
    }
  }

  // Bounded retry on 429 (any method — Intuit didn't execute it) and 5xx
  // (GETs, plus POSTs that carry a RequestId — Intuit replays those
  // idempotently). Worst case adds ~4.5s, safe under every QB route budget.
  const callWithRetry = async (token: string): Promise<Response> => {
    let res = await doCall(token)
    for (let attempt = 0; attempt < 2; attempt++) {
      const retryable =
        res.status === 429 || (res.status >= 500 && (method === 'GET' || !!opts?.requestId))
      if (!retryable) break
      const retryAfterHeader = Number(res.headers.get('retry-after'))
      const backoff = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? Math.min(retryAfterHeader * 1000, 3000)
        : 500 * 2 ** attempt + Math.random() * 250
      await new Promise((r) => setTimeout(r, backoff))
      res = await doCall(token)
    }
    return res
  }

  let token = await getAccessToken(realmId)
  let res = await callWithRetry(token)
  if (res.status === 401) {
    // Force a fresh refresh through the realm lease and retry once.
    await markAccessTokenExpired(realmId)
    token = await getAccessToken(realmId)
    res = await callWithRetry(token)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`QB ${method} ${path} ${res.status}: ${text}`)
  }
  return (await res.json()) as T
}

export function qbGet<T = unknown>(facilityId: string, path: string): Promise<T> {
  return qbFetch<T>(facilityId, 'GET', path)
}

export function qbPost<T = unknown>(
  facilityId: string,
  path: string,
  body: unknown,
  opts?: { requestId?: string },
): Promise<T> {
  return qbFetch<T>(facilityId, 'POST', path, body, opts)
}

/** Empty-body POST with Content-Type: application/octet-stream — the shape
 *  Intuit's /invoice/{id}/send (and other .../send) endpoints require. */
export function qbPostSend<T = unknown>(facilityId: string, path: string): Promise<T> {
  return qbFetch<T>(facilityId, 'POST', path, undefined, { octetStream: true })
}

/** Revoke an ENCRYPTED refresh token at Intuit (legacy signature). */
export async function revokeQBToken(encryptedRefreshToken: string): Promise<void> {
  await revokeQBRefreshToken(decryptToken(encryptedRefreshToken))
}
