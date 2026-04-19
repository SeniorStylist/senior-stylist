import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F7F6F2' }}>
      <header
        style={{ backgroundColor: '#8B2E4A' }}
        className="px-5 py-3.5 flex items-center"
      >
        <Link href="https://seniorstylist.com" target="_blank" rel="noopener noreferrer">
          <Image
            src="/Seniorstylistlogo.jpg"
            alt="Senior Stylist"
            width={120}
            height={36}
            style={{ filter: 'brightness(0) invert(1)' }}
          />
        </Link>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12">{children}</main>
      <footer className="border-t border-stone-200 mt-16 py-8 text-center text-xs text-stone-400">
        <div className="flex items-center justify-center gap-6">
          <Link href="/privacy" className="hover:text-stone-600 transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-stone-600 transition-colors">Terms of Service</Link>
          <span>© {new Date().getFullYear()} Senior Stylist LLC</span>
        </div>
      </footer>
    </div>
  )
}
