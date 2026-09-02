// Raw Intuit OAuth2 HTTP calls (authorize URL, code exchange, refresh, revoke).
// Kept free of DB imports so both quickbooks.ts and qb-connection.ts can use
// them without an import cycle.

const QB_AUTH = 'https://appcenter.intuit.com/connect/oauth2'
const QB_TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QB_REVOKE = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
const SCOPES = 'com.intuit.quickbooks.accounting'

export interface QBTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  /** Seconds the refresh token itself stays valid (Intuit: 100 days). */
  refreshExpiresIn?: number
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

// Canonical OAuth redirect URI. NEVER derive this from the incoming request
// origin — Intuit matches redirect_uri character-for-character against the
// app's registered list, so a visit from www./vercel.app/preview hosts dies on
// Intuit's "redirect_uri is invalid" page (Lisa's P56 bug). The same value must
// be used for BOTH the authorize URL and the token exchange.
export function qbRedirectUri(): string {
  if (process.env.QUICKBOOKS_REDIRECT_URI) return process.env.QUICKBOOKS_REDIRECT_URI
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://portal.seniorstylist.com').replace(/\/$/, '')
  return `${base}/api/quickbooks/callback`
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

async function tokenCall(body: URLSearchParams, label: string): Promise<QBTokens> {
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
    throw new Error(`QB ${label} failed: ${res.status} ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    x_refresh_token_expires_in?: number
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    refreshExpiresIn: data.x_refresh_token_expires_in,
  }
}

export function exchangeQBCode(code: string, redirectUri: string): Promise<QBTokens> {
  return tokenCall(
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    'token exchange',
  )
}

export function refreshQBTokens(refreshToken: string): Promise<QBTokens> {
  return tokenCall(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }), 'token refresh')
}

export async function revokeQBRefreshToken(refreshToken: string): Promise<void> {
  await fetch(QB_REVOKE, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: refreshToken }),
  })
}
