// P51 — tiny non-intrusive "payment covered" markers by a resident's name.
// Card glyph = active card on file; coin glyph = salon credit remaining.
// Renders nothing when neither — absence tells the stylist to sort out
// payment at the chair.
//
// P57 — two renderings. 'icon' (the default, so no existing call site changes)
// is the dense 12px glyph pair; 'pill' is a readable capsule for the surfaces
// a stylist reads one-handed at the chair, where the glyph + hover-only title
// told a phone user nothing. Booleans ONLY — amounts stay on billing.

import { CreditCard, Coins } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PaymentCoverage } from '@/lib/payment-signals'

const CARD_LABEL = 'Card on file — pays by saved card'
const CREDIT_LABEL = 'Salon credit available'

export function PaymentCoveredChip({
  flags,
  className,
  variant = 'icon',
}: {
  flags?: PaymentCoverage | null
  className?: string
  variant?: 'icon' | 'pill'
}) {
  if (!flags || (!flags.card && !flags.credit)) return null

  if (variant === 'pill') {
    return (
      <span className={cn('inline-flex items-center gap-1 align-middle shrink-0', className)}>
        {flags.card && (
          <span
            title={CARD_LABEL}
            aria-label={CARD_LABEL}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
          >
            <CreditCard size={11} strokeWidth={2.5} />
            Card
          </span>
        )}
        {flags.credit && (
          <span
            title={CREDIT_LABEL}
            aria-label={CREDIT_LABEL}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200"
          >
            <Coins size={11} strokeWidth={2.5} />
            Credit
          </span>
        )}
      </span>
    )
  }

  return (
    <span className={cn('inline-flex items-center gap-1 align-middle shrink-0', className)}>
      {flags.card && (
        <span title={CARD_LABEL} aria-label="Card on file" className="text-emerald-600">
          <CreditCard size={12} strokeWidth={2.25} />
        </span>
      )}
      {flags.credit && (
        <span title={CREDIT_LABEL} aria-label={CREDIT_LABEL} className="text-sky-600">
          <Coins size={12} strokeWidth={2.25} />
        </span>
      )}
    </span>
  )
}
