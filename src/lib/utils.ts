import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

// P54 — alias of the canonical formatMoney ("110" / "48.50", no "$"): the
// owner-locked customer-visible money style. See src/lib/format.ts.
export { formatMoney as formatCents } from '@/lib/format'

export function dollarsToCents(dollars: number | string): number {
  return Math.round(parseFloat(String(dollars)) * 100)
}

// Phase 12F: optional `timezone` argument. Pass facility.timezone at every
// display-side call. Without it, output uses the browser's local timezone.
export function formatDate(date: Date | string, timezone?: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(timezone ? { timeZone: timezone } : {}),
  })
}

export function formatTime(date: Date | string, timezone?: string): string {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(timezone ? { timeZone: timezone } : {}),
  })
}
