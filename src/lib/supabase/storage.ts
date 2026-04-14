import { createClient } from '@supabase/supabase-js'

export function createStorageClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export const COMPLIANCE_BUCKET = 'compliance-docs'
