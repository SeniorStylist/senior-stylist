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

export function isInstallable(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return false
  if ((window.navigator as { standalone?: boolean }).standalone === true) return false
  const device = detectDevice()
  return device !== 'desktop' && device !== 'unknown'
}

export type iOSUIVariant = 'ios26+' | 'ios16-18' | 'ios15' | 'ios-unknown'

export function getiOSVersion(): { major: number; minor: number } | null {
  if (typeof window === 'undefined') return null
  const match = navigator.userAgent.match(/(iPhone OS|CPU OS)\s+(\d+)[_.](\d+)/)
  if (!match) return null
  return { major: parseInt(match[2], 10), minor: parseInt(match[3], 10) }
}

export function getiOSUIVariant(): iOSUIVariant {
  const v = getiOSVersion()
  if (!v) return 'ios-unknown'
  if (v.major >= 26) return 'ios26+'
  if (v.major >= 16) return 'ios16-18'
  if (v.major === 15) return 'ios15'
  return 'ios-unknown'
}
