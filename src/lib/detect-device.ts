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
