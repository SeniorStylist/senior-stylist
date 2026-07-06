// Biometric App Lock (W4). Face ID / Touch ID / Android fingerprint gate over the
// app — protects resident PII when a device is left unattended at a facility.
// Native-only; every entry point no-ops on web/SSR. Preference is device-local
// (localStorage) — it's a property of THIS device, not the account.

import { isNativeApp } from '@/lib/detect-device'

const PREF_KEY = 'appLockEnabled'

export function appLockEnabled(): boolean {
  if (typeof window === 'undefined' || !isNativeApp()) return false
  return localStorage.getItem(PREF_KEY) === '1'
}

export function setAppLockEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  if (enabled) localStorage.setItem(PREF_KEY, '1')
  else localStorage.removeItem(PREF_KEY)
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (!isNativeApp()) return false
  try {
    const { NativeBiometric } = await import('@capgo/capacitor-native-biometric')
    const result = await NativeBiometric.isAvailable()
    return result.isAvailable
  } catch {
    return false
  }
}

/** Prompt Face ID / Touch ID / fingerprint. Resolves true on success. */
export async function verifyAppLock(): Promise<boolean> {
  if (!isNativeApp()) return true
  try {
    const { NativeBiometric } = await import('@capgo/capacitor-native-biometric')
    await NativeBiometric.verifyIdentity({
      reason: 'Unlock Senior Stylist',
      title: 'Unlock Senior Stylist',
      subtitle: 'Protecting resident information',
    })
    return true
  } catch {
    return false // cancelled or failed
  }
}
