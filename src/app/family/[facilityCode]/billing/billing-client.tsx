'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { SavedCardsCard } from '@/components/payments/saved-cards-card'
import { usePortalT, portalLocale, type PortalLang } from '@/lib/portal-i18n'

interface Invoice {
  id: string
  invoiceNum: string
  invoiceDate: string
  amountCents: number
  openBalanceCents: number
  status: string
}

interface Props {
  facilityCode: string
  lang: PortalLang
  residentId: string
  residentName: string
  outstandingCents: number
  autopayEnabled?: boolean
  stripeAvailable: boolean
  paymentSuccess: boolean
  giftSuccess: boolean
  facilityPhone: string | null
  facilityEmail: string | null
  invoices: Invoice[]
}

function formatDollars(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents ?? 0) / 100)
}

function formatDate(d: string, locale: string) {
  const dt = new Date(d + 'T00:00:00')
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(dt)
}

export function BillingClient({
  facilityCode,
  lang,
  residentId,
  residentName,
  outstandingCents,
  autopayEnabled = false,
  stripeAvailable,
  paymentSuccess,
  giftSuccess,
  facilityPhone,
  facilityEmail,
  invoices,
}: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const t = usePortalT(lang)
  const locale = portalLocale(lang)
  const [amountInput, setAmountInput] = useState((outstandingCents / 100).toFixed(2))
  const [submitting, setSubmitting] = useState(false)
  const [prepayInput, setPrepayInput] = useState('')
  // Phase 16 G12 — prepay package presets computed from fixed-price services
  const [packageServices, setPackageServices] = useState<{ id: string; name: string; priceCents: number }[]>([])
  const [prepaySubmitting, setPrepaySubmitting] = useState(false)

  useEffect(() => {
    if (!stripeAvailable) return
    fetch(`/api/portal/session/services?residentId=${residentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.data) setPackageServices(j.data) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [residentId, stripeAvailable])

  const startPackageCheckout = async (svc: { id: string; name: string; priceCents: number }, count: number) => {
    setPrepaySubmitting(true)
    try {
      const res = await fetch('/api/portal/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId, amountCents: svc.priceCents * count, purpose: 'prepay' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error ?? t('billing.checkoutFailed'))
        return
      }
      window.location.href = j.data.checkoutUrl
    } catch {
      toast.error(t('common.networkError'))
    } finally {
      setPrepaySubmitting(false)
    }
  }
  const [showGift, setShowGift] = useState(false)
  const [giftName, setGiftName] = useState('')
  const [giftRoom, setGiftRoom] = useState('')
  const [giftFrom, setGiftFrom] = useState('')
  const [giftAmount, setGiftAmount] = useState('')
  const [giftSubmitting, setGiftSubmitting] = useState(false)
  const shownToastRef = useRef(false)

  useEffect(() => {
    if ((paymentSuccess || giftSuccess) && !shownToastRef.current) {
      shownToastRef.current = true
      toast.success(giftSuccess ? t('billing.giftSent') : t('billing.paymentReceived'))
      router.replace(`/family/${encodeURIComponent(facilityCode)}/billing?residentId=${residentId}`)
    }
  }, [paymentSuccess, giftSuccess, toast, router, facilityCode, residentId])

  const onPay = async () => {
    const amountCents = Math.round(parseFloat(amountInput) * 100)
    if (!Number.isFinite(amountCents) || amountCents < 50) {
      toast.error(t('billing.minAmount'))
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/portal/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId, amountCents }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error ?? t('billing.checkoutFailed'))
        return
      }
      window.location.href = j.data.checkoutUrl
    } catch {
      toast.error(t('common.networkError'))
    } finally {
      setSubmitting(false)
    }
  }

  const onAddFunds = async () => {
    const amountCents = Math.round(parseFloat(prepayInput) * 100)
    if (!Number.isFinite(amountCents) || amountCents < 50) {
      toast.error(t('billing.minAmount'))
      return
    }
    setPrepaySubmitting(true)
    try {
      const res = await fetch('/api/portal/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId, amountCents, purpose: 'prepay' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error ?? t('billing.checkoutFailed'))
        return
      }
      window.location.href = j.data.checkoutUrl
    } catch {
      toast.error(t('common.networkError'))
    } finally {
      setPrepaySubmitting(false)
    }
  }

  const onSendGift = async () => {
    const amountCents = Math.round(parseFloat(giftAmount) * 100)
    if (!giftName.trim()) {
      toast.error(t('billing.enterResidentName'))
      return
    }
    if (!Number.isFinite(amountCents) || amountCents < 50) {
      toast.error(t('billing.minAmount'))
      return
    }
    setGiftSubmitting(true)
    try {
      const res = await fetch('/api/portal/gift/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityCode,
          recipientName: giftName.trim(),
          recipientRoom: giftRoom.trim() || undefined,
          amountCents,
          gifterName: giftFrom.trim() || undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error ?? t('billing.checkoutFailed'))
        return
      }
      window.location.href = j.data.checkoutUrl
    } catch {
      toast.error(t('common.networkError'))
    } finally {
      setGiftSubmitting(false)
    }
  }

  const showPay = stripeAvailable && outstandingCents > 0

  return (
    <div className="page-enter flex flex-col gap-4">
      <header>
        <h1 className="text-2xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
          {t('billing.title')}
        </h1>
        <p className="text-sm text-stone-500 mt-1">{t('appts.for', { name: residentName })}</p>
      </header>

      <section
        className={cn(
          'rounded-2xl border p-5',
          outstandingCents > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50',
        )}
      >
        <p className="text-xs uppercase tracking-wide font-semibold opacity-80">
          {outstandingCents > 0 ? t('billing.outstandingBalance') : t('billing.accountBalance')}
        </p>
        <p
          className={cn(
            'text-3xl font-semibold mt-1',
            outstandingCents > 0 ? 'text-amber-900 balance-attention' : 'text-emerald-900',
          )}
        >
          {formatDollars(outstandingCents)}
        </p>
        {autopayEnabled && (
          <p className="text-xs mt-2 font-medium text-stone-600">
            {t('billing.autopayOn')}
          </p>
        )}
      </section>

      {showPay && (
        <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
          <h2 className="text-sm font-semibold text-stone-900 mb-3">{t('billing.payOnline')}</h2>
          <label className="text-xs font-semibold text-stone-600 flex flex-col gap-1.5">
            Amount
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0.50"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="w-full rounded-xl border border-stone-200 pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
            </div>
          </label>
          <button
            type="button"
            onClick={onPay}
            disabled={submitting}
            className="w-full mt-3 bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60"
          >
            {submitting ? t('common.loading') : t('billing.payWithCard')}
          </button>
          <p className="text-[11px] text-stone-400 text-center mt-2">{t('billing.secureStripe')}</p>
        </section>
      )}

      {stripeAvailable && (
        <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
          <h2 className="text-sm font-semibold text-stone-900 mb-1">{t('billing.addFundsTitle')}</h2>
          <p className="text-xs text-stone-500 mb-3">{t('billing.addFundsHint')}</p>
          {packageServices.length > 0 && (() => {
            const svc = packageServices[0]
            return (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[3, 6].map((count) => (
                  <button
                    key={count}
                    type="button"
                    disabled={prepaySubmitting}
                    onClick={() => void startPackageCheckout(svc, count)}
                    className="rounded-xl border border-stone-200 hover:border-[#8B2E4A]/50 hover:bg-[#F9EFF2] px-3 py-3 text-left transition-colors disabled:opacity-60"
                  >
                    <p className="text-sm font-semibold text-stone-900">{count} × {svc.name}</p>
                    <p className="text-xs text-stone-500 mt-0.5">{t('billing.packageCredit', { amount: `$${((svc.priceCents * count) / 100).toFixed(2)}` })}</p>
                  </button>
                ))}
              </div>
            )
          })()}
          <label className="text-xs font-semibold text-stone-600 flex flex-col gap-1.5">
            Amount
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0.50"
                value={prepayInput}
                onChange={(e) => setPrepayInput(e.target.value)}
                placeholder="50.00"
                className="w-full rounded-xl border border-stone-200 pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
            </div>
          </label>
          <button
            type="button"
            onClick={onAddFunds}
            disabled={prepaySubmitting}
            className="w-full mt-3 bg-white text-[#8B2E4A] border border-[#8B2E4A] text-sm font-semibold rounded-xl px-5 py-3 hover:bg-[#F9EFF2] disabled:opacity-60"
          >
            {prepaySubmitting ? t('common.loading') : t('billing.addFundsWithCard')}
          </button>
          <p className="text-[11px] text-stone-400 text-center mt-2">{t('billing.secureStripe')}</p>
        </section>
      )}

      {/* Card on file — save a card for automatic payment of services (COF). */}
      <SavedCardsCard residentId={residentId} lang={lang} />

      {stripeAvailable && (
        <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
          <button type="button" onClick={() => setShowGift((s) => !s)} className="w-full flex items-center justify-between text-left">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">{t('billing.sendGift')}</h2>
              <p className="text-xs text-stone-500 mt-0.5">{t('billing.sendGiftHint')}</p>
            </div>
            <span className="text-[#8B2E4A] text-lg leading-none">{showGift ? '−' : '+'}</span>
          </button>
          {showGift && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-stone-600 flex flex-col gap-1.5 col-span-2">
                  {t('billing.residentName')}
                  <input value={giftName} onChange={(e) => setGiftName(e.target.value)} placeholder="Jane Doe" className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20" />
                </label>
                <label className="text-xs font-semibold text-stone-600 flex flex-col gap-1.5">
                  {t('billing.roomNumber')} <span className="font-normal text-stone-400">{t('billing.recommended')}</span>
                  <input value={giftRoom} onChange={(e) => setGiftRoom(e.target.value)} placeholder="12" className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20" />
                </label>
                <label className="text-xs font-semibold text-stone-600 flex flex-col gap-1.5">
                  Amount
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                    <input type="number" step="0.01" min="0.50" value={giftAmount} onChange={(e) => setGiftAmount(e.target.value)} placeholder="25.00" className="w-full rounded-xl border border-stone-200 pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20" />
                  </div>
                </label>
                <label className="text-xs font-semibold text-stone-600 flex flex-col gap-1.5 col-span-2">
                  {t('billing.yourName')} <span className="font-normal text-stone-400">{t('signup.optional')}</span>
                  <input value={giftFrom} onChange={(e) => setGiftFrom(e.target.value)} placeholder={t('billing.fromPlaceholder')} className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20" />
                </label>
              </div>
              <button type="button" onClick={onSendGift} disabled={giftSubmitting} className="w-full bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60">
                {giftSubmitting ? t('common.loading') : t('billing.sendGiftWithCard')}
              </button>
              <p className="text-[11px] text-stone-400 text-center">{t('billing.giftFootnote')}</p>
            </div>
          )}
        </section>
      )}

      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <h2 className="text-sm font-semibold text-stone-900 mb-2">{t('billing.payByCheck')}</h2>
        <p className="text-sm text-stone-600">Senior Stylist</p>
        <p className="text-sm text-stone-600">2833 Smith Ave Ste 152</p>
        <p className="text-sm text-stone-600">Baltimore, MD 21209</p>
        <p className="text-sm text-stone-500 mt-2">443-450-3344 · pmt@seniorstylist.com</p>
      </section>

      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-stone-900">{t('billing.invoices')}</h2>
          <a
            href={`/api/portal/statement/${residentId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-[#8B2E4A] hover:underline"
          >
            {t('billing.downloadStatement')}
          </a>
        </div>
        {invoices.length === 0 ? (
          <p className="text-sm text-stone-400">{t('billing.noInvoices')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-stone-100">
            {invoices.map((inv) => (
              <li key={inv.id} className="py-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-stone-900">{formatDate(inv.invoiceDate, locale)}</p>
                  <p className="text-[12px] text-stone-500 mt-0.5">{t('billing.invoiceLine', { num: inv.invoiceNum, amount: formatDollars(inv.amountCents) })}</p>
                </div>
                <span
                  className={cn(
                    'text-[10.5px] font-semibold rounded-full px-2.5 py-1 shrink-0',
                    inv.status === 'paid'
                      ? 'bg-emerald-50 text-emerald-700'
                      : inv.openBalanceCents > 0 && inv.openBalanceCents < inv.amountCents
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-amber-50 text-amber-800',
                  )}
                >
                  {inv.status === 'paid'
                    ? t('billing.paid')
                    : inv.openBalanceCents > 0 && inv.openBalanceCents < inv.amountCents
                    ? t('billing.openAmount', { amount: formatDollars(inv.openBalanceCents) })
                    : t('billing.open')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(facilityPhone || facilityEmail) && (
        <p className="text-xs text-stone-400 text-center">
          {t('billing.questions')}
          {facilityPhone && <> · {facilityPhone}</>}
          {facilityEmail && <> · {facilityEmail}</>}.
        </p>
      )}
    </div>
  )
}
