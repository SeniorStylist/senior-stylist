'use client'

// Phase 16 G3 — EN/ES pill toggle for the family portal header. Writes the
// ss_portal_lang cookie directly (no endpoint — it's a display preference, not
// data) and router.refresh()es so the force-dynamic portal pages re-render
// server-side in the new language.

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { PORTAL_LANG_COOKIE, type PortalLang } from '@/lib/portal-i18n'

const LANGS: { value: PortalLang; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'es', label: 'ES' },
]

export function LanguageToggle({ lang }: { lang: PortalLang }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const setLang = (next: PortalLang) => {
    if (next === lang) return
    // 1 year, Lax — same conventions as the facility-select cookie, but this one
    // is a pure display preference so client-set (non-httpOnly) is fine.
    document.cookie = `${PORTAL_LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    startTransition(() => router.refresh())
  }

  return (
    <div
      className="flex items-center rounded-full border border-white/20 overflow-hidden"
      role="group"
      aria-label="Language / Idioma"
    >
      {LANGS.map((l) => (
        <button
          key={l.value}
          type="button"
          onClick={() => setLang(l.value)}
          disabled={isPending}
          className={
            lang === l.value
              ? 'text-[11px] font-bold px-2 py-1 bg-white/25 text-white'
              : 'text-[11px] font-semibold px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors'
          }
          aria-pressed={lang === l.value}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
