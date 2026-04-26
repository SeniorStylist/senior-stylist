import { redirect } from 'next/navigation'

export default function SuperAdminRedirect() {
  redirect('/master-admin')
}
