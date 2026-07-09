import type { Metadata, Viewport } from 'next'
import './globals.css'
import { NativeBridge } from '@/components/native/native-bridge'
import { OfflineBanner } from '@/components/offline/offline-banner'
import { ChunkErrorRecovery } from '@/components/pwa/chunk-error-recovery'
import { AppLockGate } from '@/components/native/app-lock-gate'

export const metadata: Metadata = {
  title: 'Senior Stylist',
  description: 'Scheduling platform for hair salons in senior living facilities',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/favicon-32x32.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Senior Stylist',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#8B2E4A',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        {/* Phase 25 — fonts are self-hosted (@font-face in globals.css, files
            in /public/fonts) instead of a render-blocking Google Fonts <link>.
            Preload the two latin-subset files used on every page. */}
        <link rel="preload" href="/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/dm-serif-display-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">
        <NativeBridge />
        <OfflineBanner />
        <ChunkErrorRecovery />
        <AppLockGate />
        {children}
      </body>
    </html>
  )
}
