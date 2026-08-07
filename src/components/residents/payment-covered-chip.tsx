// P51 — tiny non-intrusive "payment covered" markers by a resident's name.
// Card glyph = active card on file; coin glyph = salon credit remaining.
// Renders nothing when neither — absence tells the stylist to sort out
// payment at the chair.

import { CreditCard, Coins } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PaymentCoverage } from '@/lib/payment-signals'

export function PaymentCoveredChip({
  flags,
  className,
}: {
  flags?: PaymentCoverage | null
  className?: string
}) {
  if (!flags || (!flags.card && !flags.credit)) return null
  return (
    <span className={cn('inline-flex items-center gap-1 align-middle shrink-0', className)}>
      {flags.card && (
        <span title="Card on file — pays by saved card" aria-label="Card on file" className="text-emerald-600">
          <CreditCard size={12} strokeWidth={2.25} />
        </span>
      )}
      {flags.credit && (
        <span title="Salon credit available" aria-label="Salon credit available" className="text-sky-600">
          <Coins size={12} strokeWidth={2.25} />
        </span>
      )}
    </span>
  )
}
