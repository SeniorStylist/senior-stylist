// P38 — the AI personal assistant endpoint. Every role gets it; capability is
// enforced by the role-filtered tool registry (src/lib/ai-assistant/tools.ts)
// and, for actions, by the EXISTING REST endpoints the client calls after the
// user confirms — this route never mutates anything.

import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { getEffectiveStylistId } from '@/lib/effective-stylist'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { db } from '@/db'
import { facilities, stylists, profiles, assistantMemories } from '@/db/schema'
import { and, eq, or, desc } from 'drizzle-orm'
import { ensureAssistantMemorySchema } from '@/lib/assistant-memory-ddl'
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
    const cookieStore = await cookies()
    const facilityUser = await getUserFacility(user.id)

    // P43 — who the assistant is talking to (identity line in the preamble).
    const profileRow = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { fullName: true },
    })
    const userName = profileRow?.fullName?.trim() || user.email || null

    // P43 — the owner is ALWAYS the owner. Josh's screenshot bug: a master
    // who ALSO holds a real facility_users row (admin at F177) entered the
    // facilityUser branch first and was DEMOTED to 'admin' — every master
    // power (network pack, facilityName targeting, switch_facility) vanished
    // while the UI (email-based isMaster) still showed master chips. RULE:
    // membership rows never demote the master email. The ONE exception is a
    // Debug role-preview (__debug_role cookie, master-verified inside
    // getUserFacility) — that feature's whole point is a faithful preview,
    // so it keeps the impersonated role but is FLAGGED on the ctx.
    const debugPreview = isMaster && !!cookieStore.get('__debug_role')?.value && !!facilityUser

    let ctx: AssistantCtx
    if (isMaster && !debugPreview) {
      // Owner: role 'master' regardless of membership rows. Facility = their
      // membership row's facility ?? the selected_facility_id cookie ?? none.
      const facId = facilityUser?.facilityId ?? cookieStore.get('selected_facility_id')?.value ?? null
      const fac = facId
        ? await db.query.facilities.findFirst({
            where: and(eq(facilities.id, facId), eq(facilities.active, true)),
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
        userName,
        debugPreview: false,
        memories: [],
        sharedMemories: [],
      }
    } else if (facilityUser) {
      // Regular roles — and the owner's Debug role-preview (faithful).
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
        userName,
        debugPreview,
        memories: [],
        sharedMemories: [],
      }
    } else {
      return Response.json({ error: 'No facility' }, { status: 400 })
    }

    // P44 — load this user's memory + applicable owner-approved shared
    // instructions (global / their role / their facility). Best-effort: an
    // unmigrated table must never break the assistant.
    try {
      await ensureAssistantMemorySchema()
      const memoryRows = await db.query.assistantMemories.findMany({
        where: and(
          eq(assistantMemories.status, 'active'),
          or(
            and(eq(assistantMemories.scope, 'user'), eq(assistantMemories.userId, user.id)),
            eq(assistantMemories.scope, 'global'),
            and(eq(assistantMemories.scope, 'role'), eq(assistantMemories.role, ctx.role)),
            ctx.facilityId
              ? and(eq(assistantMemories.scope, 'facility'), eq(assistantMemories.facilityId, ctx.facilityId))
              : undefined,
          ),
        ),
        columns: { scope: true, content: true },
        orderBy: [desc(assistantMemories.createdAt)],
        limit: 60,
      })
      ctx.memories = memoryRows.filter((r) => r.scope === 'user').slice(0, 15).map((r) => r.content)
      ctx.sharedMemories = memoryRows.filter((r) => r.scope !== 'user').slice(0, 10).map((r) => r.content)
    } catch {
      /* pre-migration or transient — assistant runs memory-less */
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
