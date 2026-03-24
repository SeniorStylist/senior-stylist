import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { stylists } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'

export default async function StylistsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (facilityUser.role !== 'admin') redirect('/dashboard')

  try {
  const stylistsList = await db.query.stylists.findMany({
    where: and(
      eq(stylists.facilityId, facilityUser.facilityId),
      eq(stylists.active, true)
    ),
    orderBy: (t, { asc }) => [asc(t.name)],
  })

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1
          className="text-2xl font-bold text-stone-900"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Stylists
        </h1>
        <p className="text-sm text-stone-500 mt-0.5">
          {stylistsList.length} active stylist{stylistsList.length !== 1 ? 's' : ''}
        </p>
      </div>

      {stylistsList.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-12 text-center">
          <p className="text-stone-400 text-sm">No stylists yet. Add one from the dashboard.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          {stylistsList.map((stylist) => (
            <Link
              key={stylist.id}
              href={`/stylists/${stylist.id}`}
              className="flex items-center gap-4 px-5 py-4 hover:bg-stone-50 transition-colors border-b border-stone-50 last:border-0"
            >
              <Avatar name={stylist.name} color={stylist.color} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-stone-900">{stylist.name}</p>
              </div>
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: stylist.color }}
                title="Calendar color"
              />
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-stone-300 shrink-0"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
  } catch (err) {
    console.error('[StylistsPage] DB error:', err)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg mt-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-600">Failed to load stylists. Please refresh to try again.</p>
        </div>
      </div>
    )
  }
}
