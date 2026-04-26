import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  role: z.enum(['admin', 'facility_staff', 'bookkeeper', 'stylist']),
  facilityId: z.string().uuid(),
  facilityName: z.string().max(200),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

  const cookieStore = await cookies()
  cookieStore.set('__debug_role', JSON.stringify(parsed.data), {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  })
  return Response.json({ data: { ok: true } })
}
