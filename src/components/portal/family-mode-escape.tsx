'use client'

// Phase 15 F5 — shown ONLY inside the native app: lets a staff member who landed
// in family mode (or a family member who chose it by mistake) get back to the
// staff sign-in. Clears the device-local family-mode flag.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isNativeApp } from '@/lib/detect-device'
import { clearFamilyMode } from '@/lib/family-mode'

export function FamilyModeEscape() {
  const router = useRouter()
  const [native, setNative] = useState(false)

  useEffect(() => {
    setNative(isNativeApp())
  }, [])

  if (!native) return null

  return (
    <button
      type="button"
      onClick={() => {
        clearFamilyMode()
        router.push('/login')
      }}
      className="block w-full text-center text-xs text-stone-400 underline underline-offset-2 py-3"
    >
      Facility staff? Switch to staff sign-in
    </button>
  )
}
