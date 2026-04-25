import { db } from '@/db'
import { portalMagicLinks, portalSessions } from '@/db/schema'
import { lt, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const linksDeleted = await db
      .delete(portalMagicLinks)
      .where(lt(portalMagicLinks.expiresAt, sql`now() - interval '7 days'`))
      .returning({ id: portalMagicLinks.id })
    const sessionsDeleted = await db
      .delete(portalSessions)
      .where(lt(portalSessions.expiresAt, sql`now()`))
      .returning({ id: portalSessions.id })
    return Response.json({
      data: { magicLinksDeleted: linksDeleted.length, sessionsDeleted: sessionsDeleted.length },
    })
  } catch (err) {
    console.error('GET /api/cron/portal-cleanup error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
