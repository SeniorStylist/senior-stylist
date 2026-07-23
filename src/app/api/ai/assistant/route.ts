// P38 — the AI personal assistant endpoint. Every role gets it; capability is
// enforced by the role-filtered tool registry (src/lib/ai-assistant/tools.ts)
// and, for actions, by the EXISTING REST endpoints the client calls after the
// user confirms — this route never mutates anything.

import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { getEffectiveStylistId } from '@/lib/effective-stylist'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { db } from '@/db'
import { facilities, stylists } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { toolsForCtx, type AssistantCtx } from '@/lib/ai-assistant/tools'
import { runAssistant, type AssistantTurn } from '@/lib/ai-assistant/gemini'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  message: z.string().min(1).max(600),
  history: z
    .array(z.object({ role: z.enum(['user', 'model']), text: z.string().max(1500) }))
    .max(10)
    .optional(),
  // P42 — Quick/Smart switch. WHITELIST enum: a raw model string never
  // reaches this route; gemini.ts maps fast→flash, smart→pro. Default fast
  // (Josh's budget call); ASSISTANT_GEMINI_MODEL env overrides both.
  model: z.enum(['fast', 'smart']).optional().default('fast'),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    if (!process.env.GEMINI_API_KEY) {
      return Response.json({ error: "The assistant isn't configured yet." }, { status: 503 })
    }

    const rl = await checkRateLimit('aiAssistant', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Send a message between 1 and 600 characters.' }, { status: 422 })
    }
    const { message, history, model } = parsed.data

    // ---- Build the assistant ctx (authority = server, never the client) ----
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isMaster = !!superAdminEmail && user.email === superAdminEmail
    const facilityUser = await getUserFacility(user.id)

    let ctx: AssistantCtx
    if (facilityUser) {
      // Regular roles — and a master DEBUG-impersonating one (faithful preview).
      const fac = await db.query.facilities.findFirst({
        where: eq(facilities.id, facilityUser.facilityId),
        columns: { id: true, name: true, facilityCode: true, timezone: true },
      })
      if (!fac) return Response.json({ error: 'No facility' }, { status: 400 })
      const role = facilityUser.role as AssistantCtx['role']
      let stylistId: string | null = null
      let stylistName: string | null = null
      if (role === 'stylist') {
        stylistId = await getEffectiveStylistId(user.id)
        if (stylistId) {
          const st = await db.query.stylists.findFirst({
            where: eq(stylists.id, stylistId),
            columns: { name: true },
          })
          stylistName = st?.name ?? null
        }
      }
      ctx = {
        userId: user.id,
        role,
        facilityId: fac.id,
        facilityName: fac.name,
        facilityCode: fac.facilityCode ?? null,
        timezone: fac.timezone ?? 'America/New_York',
        stylistId,
        stylistName,
      }
    } else if (isMaster) {
      // Plain master: getUserFacility is null before it ever reads the cookie —
      // honor selected_facility_id directly (masters may see any facility).
      const selected = (await cookies()).get('selected_facility_id')?.value
      const fac = selected
        ? await db.query.facilities.findFirst({
            where: and(eq(facilities.id, selected), eq(facilities.active, true)),
            columns: { id: true, name: true, facilityCode: true, timezone: true },
          })
        : null
      ctx = {
        userId: user.id,
        role: 'master',
        facilityId: fac?.id ?? null,
        facilityName: fac?.name ?? null,
        facilityCode: fac?.facilityCode ?? null,
        timezone: fac?.timezone ?? 'America/New_York',
        stylistId: null,
        stylistName: null,
      }
    } else {
      return Response.json({ error: 'No facility' }, { status: 400 })
    }

    const tools = toolsForCtx(ctx)
    const result = await runAssistant(ctx, message, (history ?? []) as AssistantTurn[], tools, model)
    if (!result) {
      return Response.json(
        { error: "The assistant couldn't respond just now — try again in a moment." },
        { status: 502 },
      )
    }

    return Response.json({ data: { answer: result.answer, pendingAction: result.pendingAction } })
  } catch (err) {
    console.error('POST /api/ai/assistant error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
