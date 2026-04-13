import { db } from '@/db'
import { residents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const schema = z.object({ enabled: z.boolean() })

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid body' }, { status: 422 })

    const updated = await db
      .update(residents)
      .set({ poaNotificationsEnabled: parsed.data.enabled, updatedAt: new Date() })
      .where(eq(residents.portalToken, token))
      .returning({ id: residents.id })

    if (updated.length === 0) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ data: { updated: true } })
  } catch (err) {
    console.error('PATCH /api/portal/[token]/notifications error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
