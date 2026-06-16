import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { PriceSheetsClient } from './price-sheets-client'

export default async function BulkPriceSheetsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) redirect('/dashboard')

  const list = await db.query.facilities.findMany({
    where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
    columns: { id: true, name: true, facilityCode: true },
  })
  const sorted = [...list].sort((a, b) => {
    const na = parseInt(a.facilityCode?.replace(/\D/g, '') ?? '99999', 10)
    const nb = parseInt(b.facilityCode?.replace(/\D/g, '') ?? '99999', 10)
    return na - nb || (a.name ?? '').localeCompare(b.name ?? '')
  })

  return <PriceSheetsClient facilities={sorted} />
}
