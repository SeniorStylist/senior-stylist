import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

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
