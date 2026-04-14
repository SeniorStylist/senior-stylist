import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import Image from 'next/image'

export const metadata: Metadata = {
  title: 'Senior Stylist — Resident Portal',
}

export default function ResidentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FDF8F8' }}>
      <header
        style={{ backgroundColor: '#8B2E4A' }}
        className="px-5 py-3.5 flex items-center relative overflow-hidden"
      >
        <a href="https://seniorstylist.com" target="_blank" rel="noopener noreferrer" className="relative z-10">
          <Image src="/seniorstylistlogo.jpg" alt="Senior Stylist" width={120} height={36} style={{ filter: 'brightness(0) invert(1)' }} />
        </a>
        {/* Decorative floral SVG accent */}
        <svg
          aria-hidden="true"
          viewBox="0 0 100 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: 'absolute', right: '-8px', top: '-10px', width: '80px', height: '96px', pointerEvents: 'none' }}
        >
          <path d="M50 14 C60 4 75 9 75 24 C75 37 62 41 50 44 C38 41 25 37 25 24 C25 9 40 4 50 14Z" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" fill="none"/>
          <path d="M50 44 C65 39 80 49 78 61 C76 73 62 77 50 69 C38 77 24 73 22 61 C20 49 35 39 50 44Z" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" fill="none"/>
          <path d="M50 24 C53 21 57 23 57 27 C57 31 53 33 50 31 C47 33 43 31 43 27 C43 23 47 21 50 24Z" stroke="rgba(255,255,255,0.12)" strokeWidth="1" fill="none"/>
          <path d="M50 69 C50 80 47 89 45 96" stroke="rgba(255,255,255,0.12)" strokeWidth="1.2" fill="none"/>
          <path d="M49 78 C42 72 38 64 42 60 C48 66 50 74 49 78Z" stroke="rgba(255,255,255,0.12)" strokeWidth="1" fill="none"/>
          <path d="M51 84 C58 78 62 70 58 66 C52 72 50 80 51 84Z" stroke="rgba(255,255,255,0.12)" strokeWidth="1" fill="none"/>
        </svg>
      </header>
      <main>{children}</main>
    </div>
  )
}
