export type DeviceType =
  | 'ios-safari'
  | 'ios-chrome'
  | 'ios-other'
  | 'android-chrome'
  | 'android-samsung'
  | 'android-other'
  | 'desktop'
  | 'unknown'

export function detectDevice(): DeviceType {
  if (typeof window === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  const isIOS = /iphone|ipad|ipod/i.test(ua)
  const isAndroid = /android/i.test(ua)

  if (isIOS) {
    if (/CriOS/i.test(ua)) return 'ios-chrome'
    if (/FxiOS|EdgiOS|OPiOS/i.test(ua)) return 'ios-other'
    if (/Safari/i.test(ua)) return 'ios-safari'
    return 'ios-other'
  }

  if (isAndroid) {
    if (/SamsungBrowser/i.test(ua)) return 'android-samsung'
    if (/Chrome/i.test(ua)) return 'android-chrome'
    return 'android-other'
  }

  return 'desktop'
}

/**
 * True when running inside the Capacitor native shell (iOS/Android app builds),
 * false in any browser/PWA context. Used to branch UI and capabilities toward
 * native plugins (native push, camera, biometrics) vs. their web equivalents.
 *
 * Capacitor injects `window.Capacitor` at runtime; we feature-detect it rather
 * than importing `@capacitor/core` so this helper stays safe in pure-web bundles.
 */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return cap?.isNativePlatform?.() === true
}

/** 'ios' | 'android' when in the native shell, otherwise 'web'. */
export function nativePlatform(): 'ios' | 'android' | 'web' {
  if (typeof window === 'undefined') return 'web'
  const cap = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  const p = cap?.getPlatform?.()
  return p === 'ios' || p === 'android' ? p : 'web'
}

export function isInstallable(): boolean {
  if (typeof window === 'undefined') return false
  // Already installed as a native app — never prompt the PWA install flow.
  if (isNativeApp()) return false
  if (window.matchMedia('(display-mode: standalone)').matches) return false
  if ((window.navigator as { standalone?: boolean }).standalone === true) return false
  const device = detectDevice()
  return device !== 'desktop' && device !== 'unknown'
}

export type iOSUIVariant = 'ios26+' | 'ios16-18' | 'ios-old' | 'ios-unknown'

export function getiOSVersion(): { major: number; minor: number } | null {
  if (typeof window === 'undefined') return null
  const ua = window.navigator.userAgent
  const match = ua.match(/(?:iPhone OS|CPU OS)\s+(\d+)[_.](\d+)/)
  if (!match) return null
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) }
}

export function getiOSUIVariant(): iOSUIVariant {
  const v = getiOSVersion()
  if (!v) return 'ios-unknown'
  if (v.major >= 26) return 'ios26+'
  if (v.major >= 16) return 'ios16-18'
  return 'ios-old'
}

export type AndroidBrowser =
  | 'android-chrome'
  | 'android-samsung'
  | 'android-firefox'
  | 'android-edge'
  | 'android-other'

export function detectAndroidBrowser(): AndroidBrowser {
  if (typeof window === 'undefined') return 'android-other'
  const ua = window.navigator.userAgent
  if (!ua.includes('Android')) return 'android-other'
  if (ua.includes('SamsungBrowser')) return 'android-samsung'
  if (ua.includes('Firefox')) return 'android-firefox'
  if (ua.includes('EdgA')) return 'android-edge'
  if (ua.includes('Chrome')) return 'android-chrome'
  return 'android-other'
}
