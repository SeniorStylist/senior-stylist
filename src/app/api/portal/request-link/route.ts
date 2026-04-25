import { db } from '@/db'
import { facilities, residents } from '@/db/schema'
import { createMagicLink } from '@/lib/portal-auth'
import { buildPortalMagicLinkEmailHtml, sendEmail } from '@/lib/email'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { and, eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  email: z.string().email().max(320),
  facilityCode: z.string().min(2).max(20),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ data: { sent: true } })
    }
    const email = parsed.data.email.toLowerCase()
    const facilityCode = parsed.data.facilityCode

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const emailHash = createHash('sha256').update(email).digest('hex').slice(0, 12)
    const rl = await checkRateLimit('portalRequestLink', `${ip}:${emailHash}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.facilityCode, facilityCode),
      columns: { id: true, name: true, facilityCode: true },
    })

    if (facility) {
      const matchingResidents = await db.query.residents.findMany({
        where: and(eq(residents.facilityId, facility.id), eq(residents.poaEmail, email), eq(residents.active, true)),
        columns: { id: true, name: true },
      })

      if (matchingResidents.length > 0) {
        const first = matchingResidents[0]
        const link = await createMagicLink(email, first.id, facility.facilityCode!, 72)
        sendEmail({
          to: email,
          subject: `Your Family Portal — ${facility.name}`,
          html: buildPortalMagicLinkEmailHtml({
            residentNames: matchingResidents.map((r) => r.name),
            facilityName: facility.name,
            link,
            expiresInHours: 72,
          }),
        })
      }
    }

    return Response.json({ data: { sent: true } })
  } catch (err) {
    console.error('POST /api/portal/request-link error:', err)
    return Response.json({ data: { sent: true } })
  }
}
