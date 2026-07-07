// Phase 15 F5 — "family mode" for the native app. When a family member enters
// their facility code once, we remember it device-locally so app launches route
// straight to their facility's portal instead of the staff login.

const KEY = 'ss_family_facility_code'

export function setFamilyMode(facilityCode: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(KEY, facilityCode) } catch { /* storage unavailable */ }
}

export function getFamilyMode(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function clearFamilyMode(): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
}
