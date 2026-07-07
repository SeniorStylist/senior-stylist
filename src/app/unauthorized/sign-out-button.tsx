'use client'

import { createClient } from '@/lib/supabase/client'
import { clearOfflineOnLogout } from '@/lib/offline-session'
import { useRouter } from 'next/navigation'

export function SignOutButton() {
  const router = useRouter()

  const handleSignOut = async () => {
    clearOfflineOnLogout() // Phase 18 — cached pages/data must not survive sign-out
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleSignOut}
      className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-all"
    >
      Sign out
    </button>
  )
}
