import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { db } from '@/db'
import {
  facilities,
  portalAccountResidents,
  portalAccounts,
  portalMagicLinks,
  portalSessions,
  residents,
} from '@/db/schema'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'

export const PORTAL_SESSION_COOKIE = '__portal_session'

export type PortalResident = {
  residentId: string
  residentName: string
  roomNumber: string | null
  facilityId: string
  facilityCode: string | null
  facilityName: string
}

export type PortalSession = {
  portalAccountId: string
  /** P55 — NULL for phone-only accounts (login identity is email OR phone). */
  email: string | null
  residents: PortalResident[]
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex')
}

// P53 — function, not module-load const, and with the repo-standard production
// fallback: an unset NEXT_PUBLIC_APP_URL used to mail families DEAD relative
// links ("/family/F240/auth/verify?token=…" — unclickable).
function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://senior-stylist.vercel.app').replace(/\/$/, '')
}

export async function createMagicLink(
  email: string,
  residentId: string | null,
  facilityCode: string,
  expiresInHours = 72,
): Promise<string> {
  const token = generateToken(32)
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
  await db.insert(portalMagicLinks).values({
    email: email.toLowerCase(),
    token,
    residentId: residentId ?? null,
    facilityCode,
    expiresAt,
  })
  return `${appUrl()}/family/${encodeURIComponent(facilityCode)}/auth/verify?token=${token}`
}

async function upsertAccountByEmail(email: string): Promise<string> {
  const lowered = email.toLowerCase()
  const existing = await db.query.portalAccounts.findFirst({
    where: eq(portalAccounts.email, lowered),
    columns: { id: true },
  })
  if (existing) return existing.id
  const [created] = await db.insert(portalAccounts).values({ email: lowered }).returning({ id: portalAccounts.id })
  return created.id
}

export async function linkResidentsForEmail(portalAccountId: string, email: string): Promise<void> {
  // P53 — isDemo filter: the seeded demo-poa@example.com (or any shared
  // address) must never fan demo residents into a real portal account.
  const matching = await db.query.residents.findMany({
    where: and(eq(residents.poaEmail, email.toLowerCase()), eq(residents.active, true), eq(residents.isDemo, false)),
    columns: { id: true, facilityId: true },
  })
  if (matching.length === 0) return
  for (const r of matching) {
    await db
      .insert(portalAccountResidents)
      .values({ portalAccountId, residentId: r.id, facilityId: r.facilityId })
      .onConflictDoNothing()
  }
}

export async function verifyMagicLink(
  token: string,
): Promise<{ portalAccountId: string; residentId: string | null; facilityCode: string; email: string } | null> {
  if (!token || token.length < 16) return null
  // P53 — atomic consume (UPDATE … WHERE used_at IS NULL RETURNING): the old
  // read-then-update let two requests both succeed. Mail-security scanners
  // (Microsoft Safe Links etc.) prefetch links on GET, which used to burn the
  // family's one-time link before they ever clicked — so a token consumed
  // within the last 10 minutes still verifies (the flow is idempotent: account
  // upsert + onConflictDoNothing links are safe to re-run).
  const consumed = await db
    .update(portalMagicLinks)
    .set({ usedAt: new Date() })
    .where(and(eq(portalMagicLinks.token, token), isNull(portalMagicLinks.usedAt), gt(portalMagicLinks.expiresAt, new Date())))
    .returning()
  let link: (typeof consumed)[number] | null = consumed[0] ?? null
  if (!link) {
    const graceCutoff = new Date(Date.now() - 10 * 60 * 1000)
    link =
      (await db.query.portalMagicLinks.findFirst({
        where: and(
          eq(portalMagicLinks.token, token),
          gt(portalMagicLinks.expiresAt, new Date()),
          gt(portalMagicLinks.usedAt, graceCutoff),
        ),
      })) ?? null
  }
  if (!link) return null
  const portalAccountId = await upsertAccountByEmail(link.email)
  if (link.residentId) {
    const residentRow = await db.query.residents.findFirst({
      where: eq(residents.id, link.residentId),
      columns: { id: true, facilityId: true },
    })
    if (residentRow) {
      await db
        .insert(portalAccountResidents)
        .values({ portalAccountId, residentId: residentRow.id, facilityId: residentRow.facilityId })
        .onConflictDoNothing()
    }
  }
  await linkResidentsForEmail(portalAccountId, link.email)
  // P55 — a verified email entry activates any password the family set in the
  // signup wizard (held on the claim row for matched signups — anti-takeover).
  await applyHeldClaimPassword(portalAccountId)
  return {
    portalAccountId,
    residentId: link.residentId,
    facilityCode: link.facilityCode,
    email: link.email,
  }
}

export async function createPortalSession(portalAccountId: string, days = 30): Promise<string> {
  const token = generateToken(32)
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  await db.insert(portalSessions).values({ portalAccountId, sessionToken: token, expiresAt })
  return token
}

export async function setPortalSessionCookie(token: string, days = 30): Promise<void> {
  const store = await cookies()
  store.set(PORTAL_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: days * 24 * 60 * 60,
  })
}

export async function clearPortalSessionCookie(): Promise<void> {
  const store = await cookies()
  store.set(PORTAL_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

export async function getPortalSession(): Promise<PortalSession | null> {
  try {
    const store = await cookies()
    const token = store.get(PORTAL_SESSION_COOKIE)?.value
    if (!token) return null

    const sessionRow = await db.query.portalSessions.findFirst({
      where: and(eq(portalSessions.sessionToken, token), gt(portalSessions.expiresAt, new Date())),
    })
    if (!sessionRow) return null

    const account = await db.query.portalAccounts.findFirst({
      where: eq(portalAccounts.id, sessionRow.portalAccountId),
      columns: { id: true, email: true },
    })
    if (!account) return null

    const rows = await db
      .select({
        residentId: residents.id,
        residentName: residents.name,
        roomNumber: residents.roomNumber,
        facilityId: facilities.id,
        facilityCode: facilities.facilityCode,
        facilityName: facilities.name,
        residentActive: residents.active,
      })
      .from(portalAccountResidents)
      .innerJoin(residents, eq(residents.id, portalAccountResidents.residentId))
      .innerJoin(facilities, eq(facilities.id, residents.facilityId))
      .where(eq(portalAccountResidents.portalAccountId, account.id))
      .orderBy(residents.name)

    const list: PortalResident[] = rows
      .filter((r) => r.residentActive)
      .map((r) => ({
        residentId: r.residentId,
        residentName: r.residentName,
        roomNumber: r.roomNumber,
        facilityId: r.facilityId,
        facilityCode: r.facilityCode,
        facilityName: r.facilityName,
      }))

    return { portalAccountId: account.id, email: account.email, residents: list }
  } catch (err) {
    console.error('[getPortalSession] error:', err)
    return null
  }
}

export async function revokeSession(token: string): Promise<void> {
  if (!token) return
  await db.delete(portalSessions).where(eq(portalSessions.sessionToken, token))
}

export async function requirePortalAuth(facilityCode: string): Promise<{ session: PortalSession; residentsAtFacility: PortalResident[] }> {
  const session = await getPortalSession()
  if (!session) {
    redirect(`/family/${encodeURIComponent(facilityCode)}/login`)
  }
  // P53 — case-insensitive: the URL code may be lowercase (QR apps); the
  // session carries the canonical stored code.
  const codeUpper = facilityCode.toUpperCase()
  const residentsAtFacility = session.residents.filter((r) => (r.facilityCode ?? '').toUpperCase() === codeUpper)
  if (residentsAtFacility.length === 0) {
    redirect(`/family/${encodeURIComponent(facilityCode)}/login?error=no_access`)
  }
  return { session, residentsAtFacility }
}

export async function findAccountByEmail(email: string) {
  const lowered = email.toLowerCase()
  // Column-whitelisted (P50-C7 audit): a full-row select breaks on deploys
  // that predate the onboarded_at migration. Add columns here as callers need.
  return db.query.portalAccounts.findFirst({
    where: eq(portalAccounts.email, lowered),
    columns: { id: true, email: true, passwordHash: true },
  })
}

/**
 * P55 — the login identity is email OR phone ("the username will either be
 * the email or the phone number"). '@' → email lookup; otherwise digits-only
 * phone lookup against the same normalization the unique index uses.
 */
export async function findAccountByIdentifier(identifier: string) {
  const trimmed = identifier.trim()
  if (trimmed.includes('@')) return findAccountByEmail(trimmed)
  const { normalizePhoneDigits } = await import('@/lib/phone')
  const digits = normalizePhoneDigits(trimmed)
  if (digits.length < 7) return undefined
  return db.query.portalAccounts.findFirst({
    where: sql`regexp_replace(COALESCE(${portalAccounts.phone}, ''), '\\D', '', 'g') = ${digits}`,
    columns: { id: true, email: true, passwordHash: true },
  })
}

/**
 * P55 — apply a HELD signup password after a VERIFIED entry (magic-link or
 * SMS-code). The wizard collects a password from everyone, but for MATCHED
 * signups it's parked on the claim row until the person proves possession of
 * the email/phone — typed knowledge of a poaEmail must never grant immediate
 * account access (anti-takeover rule). Only applies when the account has no
 * password yet; the claim's copy is nulled either way. Best-effort.
 */
export async function applyHeldClaimPassword(portalAccountId: string): Promise<void> {
  try {
    const { portalClaimRequests } = await import('@/db/schema')
    const account = await db.query.portalAccounts.findFirst({
      where: eq(portalAccounts.id, portalAccountId),
      columns: { id: true, email: true, phone: true, passwordHash: true },
    })
    if (!account) return

    // Newest claim carrying a held password for this identity (email or phone).
    const identityMatch = account.email
      ? eq(portalClaimRequests.email, account.email)
      : account.phone
        ? sql`regexp_replace(COALESCE(${portalClaimRequests.phone}, ''), '\\D', '', 'g') = regexp_replace(${account.phone}, '\\D', '', 'g')`
        : null
    if (!identityMatch) return

    const claim = await db.query.portalClaimRequests.findFirst({
      where: and(identityMatch, sql`${portalClaimRequests.passwordHash} IS NOT NULL`),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      columns: { id: true, passwordHash: true },
    })
    if (!claim?.passwordHash) return

    if (!account.passwordHash) {
      await db.update(portalAccounts).set({ passwordHash: claim.passwordHash }).where(eq(portalAccounts.id, account.id))
    }
    // Consumed either way — a held hash must not linger on the claim row.
    await db.update(portalClaimRequests).set({ passwordHash: null }).where(eq(portalClaimRequests.id, claim.id))
  } catch (err) {
    console.error('[portal-auth] applyHeldClaimPassword failed (non-fatal):', err)
  }
}

export async function accountHasResidentAtFacilityCode(portalAccountId: string, facilityCode: string): Promise<boolean> {
  const rows = await db
    .select({ id: portalAccountResidents.id })
    .from(portalAccountResidents)
    .innerJoin(facilities, eq(facilities.id, portalAccountResidents.facilityId))
    .where(and(eq(portalAccountResidents.portalAccountId, portalAccountId), sql`UPPER(${facilities.facilityCode}) = ${facilityCode.toUpperCase()}`))
    .limit(1)
  return rows.length > 0
}

export async function touchAccountLogin(portalAccountId: string): Promise<void> {
  await db.update(portalAccounts).set({ lastLoginAt: sql`now()` }).where(eq(portalAccounts.id, portalAccountId))
}
