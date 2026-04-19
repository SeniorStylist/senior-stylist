import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { decryptToken, encryptToken } from '@/lib/token-crypto'

const QB_BASE = 'https://quickbooks.api.intuit.com'
const QB_AUTH = 'https://appcenter.intuit.com/connect/oauth2'
const QB_TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QB_REVOKE = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
const SCOPES = 'com.intuit.quickbooks.accounting'
const REFRESH_SKEW_MS = 5 * 60 * 1000

export interface QBTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

function basicAuthHeader(): string {
  const id = requireEnv('QUICKBOOKS_CLIENT_ID')
  const secret = requireEnv('QUICKBOOKS_CLIENT_SECRET')
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`
}

export function getQBAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv('QUICKBOOKS_CLIENT_ID'),
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  })
  return `${QB_AUTH}?${params.toString()}`
}

export async function exchangeQBCode(
  code: string,
  redirectUri: string,
): Promise<QBTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  })
  const res = await fetch(QB_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`QB token exchange failed: ${res.status} ${text}`)
  }
  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}

// Dedupe concurrent refreshes per facility.
const refreshInFlight = new Map<string, Promise<string>>()

async function doRefresh(facilityId: string): Promise<string> {
  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
  })
  if (!facility) throw new Error('Facility not found')
  if (!facility.qbRefreshToken) throw new Error('QuickBooks not connected')

  const expiresAt = facility.qbTokenExpiresAt ? facility.qbTokenExpiresAt.getTime() : 0
  if (facility.qbAccessToken && expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return decryptToken(facility.qbAccessToken)
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: decryptToken(facility.qbRefreshToken),
  })
  const res = await fetch(QB_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`QB token refresh failed: ${res.status} ${text}`)
  }
  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  const newExpires = new Date(Date.now() + data.expires_in * 1000)
  await db
    .update(facilities)
    .set({
      qbAccessToken: encryptToken(data.access_token),
      qbRefreshToken: encryptToken(data.refresh_token),
      qbTokenExpiresAt: newExpires,
      updatedAt: new Date(),
    })
    .where(eq(facilities.id, facilityId))
  return data.access_token
}

export async function refreshQBToken(facilityId: string): Promise<string> {
  const existing = refreshInFlight.get(facilityId)
  if (existing) return existing
  const p = doRefresh(facilityId).finally(() => {
    refreshInFlight.delete(facilityId)
  })
  refreshInFlight.set(facilityId, p)
  return p
}

async function getRealmId(facilityId: string): Promise<string> {
  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { qbRealmId: true },
  })
  if (!facility?.qbRealmId) throw new Error('QuickBooks realm missing')
  return facility.qbRealmId
}

async function qbFetch<T>(
  facilityId: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const realmId = await getRealmId(facilityId)
  const url = `${QB_BASE}/v3/company/${realmId}${path}`

  const doCall = async (token: string): Promise<Response> => {
    return fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  const logTid = (response: Response) => {
    const tid = response.headers.get('intuit_tid')
    if (tid) console.log(`[QB] intuit_tid=${tid} path=${path} status=${response.status}`)
  }

  let token = await refreshQBToken(facilityId)
  let res = await doCall(token)
  logTid(res)
  if (res.status === 401) {
    // Force a fresh refresh by clearing the cached access token.
    await db
      .update(facilities)
      .set({ qbTokenExpiresAt: new Date(0), updatedAt: new Date() })
      .where(eq(facilities.id, facilityId))
    token = await refreshQBToken(facilityId)
    res = await doCall(token)
    logTid(res)
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
): Promise<T> {
  return qbFetch<T>(facilityId, 'POST', path, body)
}

export async function revokeQBToken(encryptedRefreshToken: string): Promise<void> {
  await fetch(QB_REVOKE, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: decryptToken(encryptedRefreshToken) }),
  })
}
