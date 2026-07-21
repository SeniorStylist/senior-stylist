// P35 — "Ask AI" business analyst. READ-ONLY: the model never writes SQL and
// never touches the DB; it answers from a fixed, role-scoped data pack (see
// src/lib/ai-analyst.ts for the safety contract). Money data → same role gate
// class as /api/stats: admin (incl. normalized super_admin), bookkeeper, and
// the master admin only.

import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { buildFacilityDataPack, buildMasterDataPack, askAnalyst } from '@/lib/ai-analyst'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { NextRequest } from 'next/server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  question: z.string().min(3).max(500),
  history: z
    .array(z.object({ q: z.string().max(500), a: z.string().max(2000) }))
    .max(3)
    .optional(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    if (!process.env.GEMINI_API_KEY) {
      return Response.json({ error: "The AI analyst isn't configured yet." }, { status: 503 })
    }

    const rl = await checkRateLimit('aiAnalyst', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isMaster = !!superAdminEmail && user.email === superAdminEmail

    const facilityUser = await getUserFacility(user.id)
    const role = facilityUser?.role
    if (!isMaster && role !== 'admin' && role !== 'bookkeeper') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Ask a question between 3 and 500 characters.' }, { status: 422 })
    }
    const { question, history } = parsed.data

    // Scope from the CALLER's role — never from the question. Admins/bookkeepers
    // get their currently selected facility; a master DEBUG-impersonating a
    // facility role gets that facility's pack. P38 fix: a plain master admin has
    // no facility_users row (getUserFacility → null before it ever reads the
    // selected_facility_id cookie), so "Who owes us the most?" on /analytics
    // with a facility selected wrongly got the NETWORK pack (no resident
    // balances — Josh's screenshot). Masters may see any facility, so honor
    // their selected-facility cookie directly.
    let masterSelectedFacilityId: string | null = null
    if (isMaster && !facilityUser) {
      const selected = (await cookies()).get('selected_facility_id')?.value
      if (selected) {
        const fac = await db.query.facilities.findFirst({
          where: and(eq(facilities.id, selected), eq(facilities.active, true)),
          columns: { id: true },
        })
        masterSelectedFacilityId = fac?.id ?? null
      }
    }
    const pack = isMaster && !facilityUser
      ? masterSelectedFacilityId
        ? await buildFacilityDataPack(masterSelectedFacilityId)
        : await buildMasterDataPack()
      : await buildFacilityDataPack(facilityUser!.facilityId)

    const answer = await askAnalyst(question, history ?? [], pack)
    if (!answer) {
      return Response.json(
        { error: "The analyst couldn't answer just now — try again in a moment." },
        { status: 502 },
      )
    }

    return Response.json({ data: { answer } })
  } catch (err) {
    console.error('POST /api/ai/analyst error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
