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
  email: string
  residents: PortalResident[]
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex')
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')

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
  return `${APP_URL}/family/${encodeURIComponent(facilityCode)}/auth/verify?token=${token}`
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

async function linkResidentsForEmail(portalAccountId: string, email: string): Promise<void> {
  const matching = await db.query.residents.findMany({
    where: and(eq(residents.poaEmail, email.toLowerCase()), eq(residents.active, true)),
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
  const link = await db.query.portalMagicLinks.findFirst({
    where: and(eq(portalMagicLinks.token, token), isNull(portalMagicLinks.usedAt), gt(portalMagicLinks.expiresAt, new Date())),
  })
  if (!link) return null
  await db.update(portalMagicLinks).set({ usedAt: new Date() }).where(eq(portalMagicLinks.id, link.id))
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
  const residentsAtFacility = session.residents.filter((r) => r.facilityCode === facilityCode)
  if (residentsAtFacility.length === 0) {
    redirect(`/family/${encodeURIComponent(facilityCode)}/login?error=no_access`)
  }
  return { session, residentsAtFacility }
}

export async function findAccountByEmail(email: string) {
  const lowered = email.toLowerCase()
  return db.query.portalAccounts.findFirst({
    where: eq(portalAccounts.email, lowered),
  })
}

export async function accountHasResidentAtFacilityCode(portalAccountId: string, facilityCode: string): Promise<boolean> {
  const rows = await db
    .select({ id: portalAccountResidents.id })
    .from(portalAccountResidents)
    .innerJoin(facilities, eq(facilities.id, portalAccountResidents.facilityId))
    .where(and(eq(portalAccountResidents.portalAccountId, portalAccountId), eq(facilities.facilityCode, facilityCode)))
    .limit(1)
  return rows.length > 0
}

export async function touchAccountLogin(portalAccountId: string): Promise<void> {
  await db.update(portalAccounts).set({ lastLoginAt: sql`now()` }).where(eq(portalAccounts.id, portalAccountId))
}
