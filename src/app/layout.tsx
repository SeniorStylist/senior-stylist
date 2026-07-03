import type { Metadata, Viewport } from 'next'
import './globals.css'
import { NativeBridge } from '@/components/native/native-bridge'

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
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300..700&family=DM+Serif+Display&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <NativeBridge />
        {children}
      </body>
    </html>
  )
}
