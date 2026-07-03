// Haptic feedback helper. No-ops on the web/PWA and during SSR — only fires inside
// the Capacitor native shell. Plugin is dynamically imported so it never enters the
// web bundle. Every call is wrapped so a missing plugin / unsupported device is silent.

import { isNativeApp } from '@/lib/detect-device'

type Impact = 'light' | 'medium' | 'heavy'
type Notify = 'success' | 'warning' | 'error'

async function impact(style: Impact): Promise<void> {
  if (!isNativeApp()) return
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }
    await Haptics.impact({ style: map[style] })
  } catch {
    /* unsupported / not native — ignore */
  }
}

async function notify(type: Notify): Promise<void> {
  if (!isNativeApp()) return
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics')
    const map = { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error }
    await Haptics.notification({ type: map[type] })
  } catch {
    /* ignore */
  }
}

async function selection(): Promise<void> {
  if (!isNativeApp()) return
  try {
    const { Haptics } = await import('@capacitor/haptics')
    await Haptics.selectionStart()
    await Haptics.selectionChanged()
    await Haptics.selectionEnd()
  } catch {
    /* ignore */
  }
}

/**
 * Fire-and-forget haptics. Call from any click/toggle/navigation handler — safe
 * everywhere (no-op off-device). e.g. `haptics.light()` on a button press,
 * `haptics.success()` after a save, `haptics.selection()` on a tab switch.
 */
export const haptics = {
  light: () => void impact('light'),
  medium: () => void impact('medium'),
  heavy: () => void impact('heavy'),
  success: () => void notify('success'),
  warning: () => void notify('warning'),
  error: () => void notify('error'),
  selection: () => void selection(),
}
