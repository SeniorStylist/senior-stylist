import type { ReactNode } from 'react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Senior Stylist — Resident Portal',
}

export default function ResidentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50">
      <header
        style={{ backgroundColor: '#0D7377' }}
        className="px-4 py-3 flex items-center"
      >
        <span className="text-white font-semibold text-sm tracking-wide">Senior Stylist</span>
      </header>
      <main>{children}</main>
    </div>
  )
}
