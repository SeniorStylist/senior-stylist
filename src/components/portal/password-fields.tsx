'use client'

// P55 — the signup wizard's password + confirm pair, owner-specced: strength
// meter (weak/medium/strong), live match indicator, show/hide toggles. Senior
// UX: 18px inputs (kills iOS zoom), ≥52px touch targets, one clear signal per
// row. Reusable anywhere the portal collects a password.

import { useState } from 'react'
import { makePortalT, type PortalLang } from '@/lib/portal-i18n'

interface PasswordFieldsProps {
  password: string
  confirm: string
  onPasswordChange: (v: string) => void
  onConfirmChange: (v: string) => void
  lang?: PortalLang
}

/** 0 = too short, 1 = weak, 2 = medium, 3 = strong */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < 8) return 0
  let classes = 0
  if (/[a-z]/.test(pw)) classes++
  if (/[A-Z]/.test(pw)) classes++
  if (/\d/.test(pw)) classes++
  if (/[^A-Za-z0-9]/.test(pw)) classes++
  const score = classes + (pw.length >= 12 ? 1 : 0)
  if (score >= 4) return 3
  if (score >= 3) return 2
  return 1
}

function EyeButton({ shown, onToggle, label }: { shown: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-1"
      tabIndex={-1}
    >
      {shown ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  )
}

export function PasswordFields({ password, confirm, onPasswordChange, onConfirmChange, lang = 'en' }: PasswordFieldsProps) {
  const t = makePortalT(lang)
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const strength = passwordStrength(password)
  const strengthLabel =
    strength === 3 ? t('password.strong') : strength === 2 ? t('password.medium') : strength === 1 ? t('password.weak') : t('password.tooShort')
  const strengthColor = strength === 3 ? '#059669' : strength === 2 ? '#CA8A04' : '#D97706'
  const matches = confirm.length > 0 && password === confirm

  const inputCls =
    'w-full rounded-2xl border border-stone-200 px-4 pr-12 text-lg min-h-[52px] focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20'

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <input
          id="signup-password"
          type={showPw ? 'text' : 'password'}
          autoComplete="new-password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder={t('password.placeholder')}
          maxLength={200}
          aria-label={t('password.label')}
          className={inputCls}
        />
        <EyeButton shown={showPw} onToggle={() => setShowPw((v) => !v)} label={showPw ? t('password.hide') : t('password.show')} />
      </div>

      {/* Strength meter — three segments, filled by score */}
      {password.length > 0 && (
        <div>
          <div className="flex gap-1.5" aria-hidden>
            {[1, 2, 3].map((seg) => (
              <div
                key={seg}
                className="h-1.5 flex-1 rounded-full transition-colors"
                style={{ backgroundColor: strength >= seg ? strengthColor : '#E7E5E4' }}
              />
            ))}
          </div>
          <p className="text-sm mt-1.5" style={{ color: strength === 0 ? '#78716C' : strengthColor }} role="status">
            {strengthLabel}
          </p>
        </div>
      )}

      <div className="relative">
        <input
          id="signup-password-confirm"
          type={showConfirm ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => onConfirmChange(e.target.value)}
          placeholder={t('password.confirmPlaceholder')}
          maxLength={200}
          aria-label={t('password.confirmLabel')}
          className={inputCls}
        />
        <EyeButton shown={showConfirm} onToggle={() => setShowConfirm((v) => !v)} label={showConfirm ? t('password.hide') : t('password.show')} />
      </div>

      {confirm.length > 0 && (
        <p className="text-sm" style={{ color: matches ? '#059669' : '#DC2626' }} role="status">
          {matches ? `✓ ${t('password.match')}` : t('password.noMatch')}
        </p>
      )}
    </div>
  )
}
