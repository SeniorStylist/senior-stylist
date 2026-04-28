'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { getiOSUIVariant, getiOSVersion } from '@/lib/detect-device'
import type { DeviceType, iOSUIVariant } from '@/lib/detect-device'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface InstallGuideProps {
  isOpen: boolean
  onClose: () => void
  deviceType: DeviceType
  deferredPrompt?: BeforeInstallPromptEvent | null
  onInstalled?: () => void
}

function StepNumber({ n }: { n: number }) {
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-sm font-bold text-white" style={{ backgroundColor: '#8B2E4A' }}>
      {n}
    </div>
  )
}

// iOS 26+ floating pill address bar with share button on the right
function iOS26AddressBarMockup() {
  return (
    <div className="relative mt-3">
      <div className="bg-stone-100 rounded-2xl p-3">
        {/* Page content behind */}
        <div className="h-14 bg-white rounded-xl border border-stone-200 mb-3 flex items-center justify-center">
          <p className="text-xs text-stone-300">page content</p>
        </div>
        {/* Floating pill address bar */}
        <div className="flex items-center gap-2 bg-white rounded-full px-3 py-2 border border-stone-200 shadow-md">
          <div className="w-3 h-3 rounded-full bg-stone-200 shrink-0" />
          <div className="flex-1 bg-stone-100 rounded-full h-3.5" />
          {/* Share button highlighted */}
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center border-2 shrink-0"
            style={{ backgroundColor: 'rgba(139,46,74,0.1)', borderColor: '#8B2E4A' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
              <polyline points="16 6 12 2 8 6"/>
              <line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
          </div>
        </div>
      </div>
      {/* Arrow pointing down to the share button on the right of the address bar */}
      <div className="absolute bottom-[18px] right-[22px] -translate-y-full animate-bounce" style={{ color: '#8B2E4A' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 16l-6-6h12z"/></svg>
      </div>
    </div>
  )
}

// iOS Safari classic bottom toolbar (iOS 16-18)
function SafariToolbarMockup() {
  return (
    <div className="relative mt-3">
      <div className="bg-stone-100 rounded-2xl p-3">
        {/* Address bar row */}
        <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-1.5 mb-3 border border-stone-200">
          <div className="w-3 h-3 rounded-full bg-stone-200 shrink-0" />
          <div className="flex-1 bg-stone-100 rounded-full h-4" />
          <div className="w-3 h-3 rounded-full bg-stone-200 shrink-0" />
        </div>
        {/* Toolbar icons */}
        <div className="flex items-center justify-around px-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          {/* Share — highlighted */}
          <div className="w-10 h-10 rounded-xl flex items-center justify-center border-2" style={{ backgroundColor: 'rgba(139,46,74,0.1)', borderColor: '#8B2E4A' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
              <polyline points="16 6 12 2 8 6"/>
              <line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        </div>
      </div>
      {/* Bouncing arrow pointing down to the share icon in the center */}
      <div className="absolute -top-7 left-1/2 -translate-x-1/2 animate-bounce" style={{ color: '#8B2E4A' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 16l-6-6h12z"/></svg>
      </div>
    </div>
  )
}

// Share sheet with "Add to Home Screen" highlighted
function ShareSheetMockup() {
  return (
    <div className="mt-3 bg-stone-100 rounded-2xl p-3">
      <div className="bg-white rounded-xl overflow-hidden border border-stone-200">
        {['Copy', 'AirDrop'].map((label) => (
          <div key={label} className="flex items-center gap-3 px-4 py-3 border-b border-stone-100">
            <div className="w-8 h-8 rounded-xl bg-stone-100" />
            <span className="text-sm text-stone-400">{label}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-100" style={{ backgroundColor: 'rgba(139,46,74,0.07)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center border-2" style={{ borderColor: '#8B2E4A', backgroundColor: 'rgba(139,46,74,0.1)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            </div>
            <span className="text-sm font-semibold" style={{ color: '#8B2E4A' }}>Add to Home Screen</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 rounded-xl bg-stone-100" />
          <span className="text-sm text-stone-400">Find on Page</span>
        </div>
      </div>
    </div>
  )
}

// iOS confirmation dialog
function AddConfirmMockup() {
  return (
    <div className="mt-3 bg-stone-100 rounded-2xl p-3">
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden mx-4">
        <div className="px-5 py-4 text-center border-b border-stone-100">
          <div className="w-12 h-12 rounded-2xl mx-auto mb-2 overflow-hidden border border-stone-200" style={{ backgroundColor: '#1C0A12' }}>
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-white text-xs font-bold">SS</span>
            </div>
          </div>
          <p className="text-sm font-semibold text-stone-900">Senior Stylist</p>
          <p className="text-xs text-stone-400">senior-stylist.vercel.app</p>
        </div>
        <div className="flex">
          <button className="flex-1 py-3 text-sm text-stone-400 text-center border-r border-stone-100">Cancel</button>
          <button className="flex-1 py-3 text-sm font-semibold text-center" style={{ color: '#8B2E4A' }}>Add</button>
        </div>
      </div>
    </div>
  )
}

// Chrome menu mockup (Android)
function ChromeMenuMockup() {
  return (
    <div className="relative mt-3">
      <div className="bg-stone-100 rounded-2xl p-3">
        <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 mb-3 border border-stone-200">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <div className="flex-1 bg-stone-100 rounded-full h-4" />
          <div className="w-8 h-8 rounded-lg flex items-center justify-center border-2" style={{ backgroundColor: 'rgba(139,46,74,0.1)', borderColor: '#8B2E4A' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#8B2E4A"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </div>
        </div>
        <div className="h-16 bg-white rounded-xl border border-stone-200 flex items-center justify-center">
          <p className="text-xs text-stone-300">page content</p>
        </div>
      </div>
      <div className="absolute -top-7 right-6 animate-bounce" style={{ color: '#8B2E4A' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 16l-6-6h12z"/></svg>
      </div>
    </div>
  )
}

// Chrome dropdown with "Add to Home screen" highlighted
function ChromeDropdownMockup() {
  return (
    <div className="mt-3 bg-stone-100 rounded-2xl p-3">
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden ml-auto w-48">
        {['New tab', 'New incognito tab'].map((label) => (
          <div key={label} className="px-4 py-2.5 border-b border-stone-100">
            <span className="text-sm text-stone-400">{label}</span>
          </div>
        ))}
        <div className="px-4 py-2.5 border-b border-stone-100" style={{ backgroundColor: 'rgba(139,46,74,0.07)' }}>
          <span className="text-sm font-semibold" style={{ color: '#8B2E4A' }}>Add to Home screen</span>
        </div>
        {['Bookmarks', 'History'].map((label) => (
          <div key={label} className="px-4 py-2.5 border-b border-stone-100 last:border-0">
            <span className="text-sm text-stone-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Chrome address bar with "aA" for iOS Chrome → Safari redirect
function ChromeAddressBarMockup() {
  return (
    <div className="relative mt-3">
      <div className="bg-stone-100 rounded-2xl p-3">
        <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-stone-200">
          <div className="px-2 py-1 rounded-lg border-2 text-xs font-bold" style={{ backgroundColor: 'rgba(139,46,74,0.1)', borderColor: '#8B2E4A', color: '#8B2E4A' }}>
            aA
          </div>
          <div className="flex-1 bg-stone-100 rounded-full h-4" />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        </div>
      </div>
      <div className="absolute -top-7 left-8 animate-bounce" style={{ color: '#8B2E4A' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 16l-6-6h12z"/></svg>
      </div>
    </div>
  )
}

// Samsung Internet menu mockup
function SamsungMenuMockup() {
  return (
    <div className="relative mt-3">
      <div className="bg-stone-100 rounded-2xl p-3">
        <div className="flex items-center justify-between gap-2 bg-white rounded-xl px-3 py-2 mb-3 border border-stone-200">
          <div className="flex-1 bg-stone-100 rounded-full h-4" />
          <div className="w-8 h-8 rounded-lg flex items-center justify-center border-2" style={{ backgroundColor: 'rgba(139,46,74,0.1)', borderColor: '#8B2E4A' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#8B2E4A"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="3" y="11" width="18" height="2" rx="1"/><rect x="3" y="17" width="18" height="2" rx="1"/></svg>
          </div>
        </div>
        <div className="h-12 bg-white rounded-xl border border-stone-200 flex items-center justify-center">
          <p className="text-xs text-stone-300">page content</p>
        </div>
      </div>
      <div className="absolute -top-7 right-6 animate-bounce" style={{ color: '#8B2E4A' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 16l-6-6h12z"/></svg>
      </div>
    </div>
  )
}

// ── Paginated step guide ──────────────────────────────────────────────────────

interface Step {
  title: string
  description: string
  note?: string
  mockup?: ReactNode
}

function PaginatedGuide({
  steps,
  versionBadge,
  disclaimer,
  onClose,
  isOpen,
}: {
  steps: Step[]
  versionBadge?: string
  disclaimer?: string
  onClose: () => void
  isOpen: boolean
}) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!isOpen) setStep(0)
  }, [isOpen])

  const isLast = step === steps.length - 1
  const current = steps[step]

  return (
    <div className="px-5 pb-4">
      {/* Version badge */}
      {versionBadge && (
        <div className="flex justify-center mb-4 mt-1">
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-stone-100 text-stone-500 font-medium">
            {versionBadge}
          </span>
        </div>
      )}

      {/* Dot progress */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {steps.map((_, i) => (
          <button
            key={i}
            onClick={() => setStep(i)}
            className="h-2 rounded-full transition-all duration-200"
            style={{
              width: i === step ? '20px' : '8px',
              backgroundColor: i === step ? '#8B2E4A' : '#e7e5e4',
            }}
            aria-label={`Go to step ${i + 1}`}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="flex items-start gap-3">
        <StepNumber n={step + 1} />
        <div className="flex-1">
          <p className="text-sm font-semibold text-stone-900">{current.title}</p>
          <p className="text-sm text-stone-500 mt-0.5">{current.description}</p>
          {current.note && (
            <p className="text-xs text-amber-700 mt-1.5 italic bg-amber-50 px-2 py-1.5 rounded-lg border border-amber-100">
              {current.note}
            </p>
          )}
          {current.mockup}
        </div>
      </div>

      {/* Disclaimer */}
      {disclaimer && (
        <p className="text-xs text-stone-400 text-center mt-4 italic">{disclaimer}</p>
      )}

      {/* Navigation */}
      <div className="flex gap-3 mt-5 border-t border-stone-100 pt-4">
        <button
          onClick={() => step > 0 ? setStep((s: number) => s - 1) : onClose()}
          className="py-3 px-5 rounded-2xl text-sm font-medium border border-stone-200 text-stone-500 transition-colors"
        >
          {step > 0 ? '← Back' : 'Later'}
        </button>
        <button
          onClick={() => isLast ? onClose() : setStep((s: number) => s + 1)}
          className="flex-1 py-3 rounded-2xl text-white text-sm font-semibold shadow-sm transition-all active:scale-[0.97]"
          style={{ backgroundColor: '#8B2E4A' }}
        >
          {isLast ? 'Done — open it from your home screen!' : 'Next →'}
        </button>
      </div>
    </div>
  )
}

// ── Per-device guides ─────────────────────────────────────────────────────────

function IOSSafariGuide({
  variant,
  version,
  onClose,
  isOpen,
}: {
  variant: iOSUIVariant
  version: { major: number; minor: number } | null
  onClose: () => void
  isOpen: boolean
}) {
  const versionBadge =
    variant === 'ios26+'
      ? '✦ New iOS 26 design detected'
      : version
        ? `Detected: iOS ${version.major}.${version.minor}`
        : undefined

  const disclaimer =
    variant === 'ios-unknown'
      ? 'Steps may look slightly different on your iOS version.'
      : undefined

  const step1: Step =
    variant === 'ios26+'
      ? {
          title: 'Tap Share in the address bar',
          description: 'Find the share icon on the right side of the floating address bar.',
          mockup: <iOS26AddressBarMockup />,
        }
      : {
          title: 'Tap the Share button',
          description: 'Find it in the Safari toolbar at the bottom of the screen.',
          mockup: <SafariToolbarMockup />,
        }

  const step2: Step = {
    title: 'Tap "Add to Home Screen"',
    description: 'Scroll down in the share sheet to find this option.',
    note: variant === 'ios15' ? 'You may need to scroll up in the share sheet to find it.' : undefined,
    mockup: <ShareSheetMockup />,
  }

  const step3: Step = {
    title: 'Tap "Add"',
    description: 'Confirm to add the app to your home screen.',
    mockup: <AddConfirmMockup />,
  }

  return (
    <PaginatedGuide
      steps={[step1, step2, step3]}
      versionBadge={versionBadge}
      disclaimer={disclaimer}
      onClose={onClose}
      isOpen={isOpen}
    />
  )
}

function IOSChromeGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="px-5 pb-4">
      <div className="mt-4 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-sm text-amber-800 mb-4">
        <strong>One quick step needed:</strong> This page needs to be open in Safari to save to your home screen.
      </div>

      <div className="flex items-start gap-3">
        <StepNumber n={1} />
        <div className="flex-1">
          <p className="text-sm font-semibold text-stone-900">Tap the "aA" button</p>
          <p className="text-sm text-stone-500 mt-0.5">Find it on the left side of the address bar.</p>
          <ChromeAddressBarMockup />
        </div>
      </div>

      <div className="flex items-start gap-3 mt-6">
        <StepNumber n={2} />
        <div className="flex-1">
          <p className="text-sm font-semibold text-stone-900">Tap "Open in Safari"</p>
          <p className="text-sm text-stone-500 mt-0.5">Once in Safari, follow the iOS Safari steps above.</p>
        </div>
      </div>

      <button
        onClick={onClose}
        className="w-full py-4 text-center text-sm text-stone-400 border-t border-stone-100 mt-6"
      >
        Got it
      </button>
    </div>
  )
}

function AndroidChromeGuide({
  deferredPrompt,
  onInstalled,
  onClose,
}: {
  deferredPrompt?: BeforeInstallPromptEvent | null
  onInstalled?: () => void
  onClose: () => void
}) {
  const handleNativeInstall = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      onInstalled?.()
      onClose()
    }
  }

  if (deferredPrompt) {
    return (
      <div className="px-5 pb-6">
        <p className="text-sm text-stone-600 mt-2 mb-6">
          Tap below to add Senior Stylist to your home screen for faster access.
        </p>
        <button
          onClick={handleNativeInstall}
          className="w-full py-4 rounded-2xl text-white font-semibold text-sm shadow-md transition-all active:scale-[0.97]"
          style={{ backgroundColor: '#8B2E4A' }}
        >
          Install App
        </button>
        <button
          onClick={onClose}
          className="w-full py-4 text-center text-sm text-stone-400 border-t border-stone-100 mt-4"
        >
          Got it — I'll do this later
        </button>
      </div>
    )
  }

  return (
    <div className="px-5 pb-4">
      <div className="flex items-start gap-3 mt-2">
        <StepNumber n={1} />
        <div className="flex-1">
          <p className="text-sm font-semibold text-stone-900">Tap the menu (⋮) in the top right</p>
          <ChromeMenuMockup />
        </div>
      </div>

      <div className="flex items-start gap-3 mt-6">
        <StepNumber n={2} />
        <div className="flex-1">
          <p className="text-sm font-semibold text-stone-900">Tap "Add to Home screen"</p>
          <ChromeDropdownMockup />
        </div>
      </div>

      <button
        onClick={onClose}
        className="w-full py-4 text-center text-sm text-stone-400 border-t border-stone-100 mt-6"
      >
        Got it — I'll do this later
      </button>
    </div>
  )
}

function AndroidSamsungGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="px-5 pb-4">
      <div className="flex items-start gap-3 mt-2">
        <StepNumber n={1} />
        <div className="flex-1">
          <p className="text-sm font-semibold text-stone-900">Tap the menu (≡) in the bottom bar</p>
          <SamsungMenuMockup />
        </div>
      </div>

      <div className="flex items-start gap-3 mt-6">
        <StepNumber n={2} />
        <div className="flex-1">
          <p className="text-sm font-semibold text-stone-900">Tap "Add page to" → "Home screen"</p>
          <p className="text-sm text-stone-500 mt-0.5">The option may be labeled "Add to" in some versions.</p>
        </div>
      </div>

      <button
        onClick={onClose}
        className="w-full py-4 text-center text-sm text-stone-400 border-t border-stone-100 mt-6"
      >
        Got it — I'll do this later
      </button>
    </div>
  )
}

function GenericGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="px-5 pb-6">
      <p className="text-sm text-stone-600 mt-2 mb-4">
        Open your browser&apos;s menu and look for <strong>&quot;Add to Home Screen&quot;</strong> or <strong>&quot;Install App&quot;</strong>.
      </p>
      <button
        onClick={onClose}
        className="w-full py-4 text-center text-sm text-stone-400 border-t border-stone-100 mt-2"
      >
        Got it
      </button>
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export function InstallGuide({ isOpen, onClose, deviceType, deferredPrompt, onInstalled }: InstallGuideProps) {
  const iOSVariant = deviceType === 'ios-safari' ? getiOSUIVariant() : 'ios-unknown'
  const iOSVersion = deviceType === 'ios-safari' ? getiOSVersion() : null

  const title =
    deviceType === 'ios-chrome'
      ? 'Switch to Safari'
      : 'Add to Home Screen'

  const subtitle =
    deviceType === 'ios-chrome'
      ? 'One quick step to save as an app'
      : 'Open Senior Stylist like an app'

  const content = () => {
    switch (deviceType) {
      case 'ios-safari':
        return <IOSSafariGuide variant={iOSVariant} version={iOSVersion} onClose={onClose} isOpen={isOpen} />
      case 'ios-chrome':
        return <IOSChromeGuide onClose={onClose} />
      case 'android-chrome':
        return <AndroidChromeGuide deferredPrompt={deferredPrompt} onInstalled={onInstalled} onClose={onClose} />
      case 'android-samsung':
        return <AndroidSamsungGuide onClose={onClose} />
      default:
        return <GenericGuide onClose={onClose} />
    }
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>
      <div>
        <p className="text-sm text-stone-500 px-5 pt-1 pb-2">{subtitle}</p>
        {content()}
      </div>
    </BottomSheet>
  )
}
