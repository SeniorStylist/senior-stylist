import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Senior Stylist',
  description: 'Scheduling platform for hair salons in senior living facilities',
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
      <body className="antialiased">{children}</body>
    </html>
  )
}
