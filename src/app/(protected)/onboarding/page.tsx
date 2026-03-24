import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserFacility } from '@/lib/get-facility-id'
import OnboardingClient from './onboarding-client'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // If user already has a facility, send them to dashboard
  const facilityUser = await getUserFacility(user.id)
  if (facilityUser) redirect('/dashboard')

  return <OnboardingClient />
}
