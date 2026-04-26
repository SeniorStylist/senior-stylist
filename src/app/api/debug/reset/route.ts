import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const cookieStore = await cookies()
  cookieStore.set('__debug_role', '', { maxAge: 0, path: '/' })
  return Response.json({ data: { ok: true } })
}
