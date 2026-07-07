// Phase 15 F7 — Tap to Pay via Stripe Terminal (native app only, DORMANT until
// NEXT_PUBLIC_TAP_TO_PAY_ENABLED='true'). haptics.ts pattern: every plugin import
// is dynamic + try/caught so nothing enters the web bundle and everything no-ops
// off-device.
//
// Go-live gate (see docs/native-app.md → "Tap to Pay"): Apple proximity-reader
// entitlement approval + entitlements file, Android location/NFC permissions, a
// Stripe Terminal Location (STRIPE_TERMINAL_LOCATION_ID), then flip the flag.

import { isNativeApp } from '@/lib/detect-device'

export function tapToPayAvailable(): boolean {
  return isNativeApp() && process.env.NEXT_PUBLIC_TAP_TO_PAY_ENABLED === 'true'
}

let _initialized = false

async function getTerminal() {
  const { StripeTerminal, TerminalConnectTypes, TerminalEventsEnum } =
    await import('@capacitor-community/stripe-terminal')
  return { StripeTerminal, TerminalConnectTypes, TerminalEventsEnum }
}

async function fetchConnectionToken(): Promise<string> {
  const res = await fetch('/api/payments/terminal/connection-token', { method: 'POST' })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Could not get a Terminal token')
  return j.data.secret as string
}

/** Initialize the Terminal SDK (once) with our connection-token provider. */
export async function initTerminal(): Promise<void> {
  if (!tapToPayAvailable()) throw new Error('Tap to Pay is not available on this device')
  if (_initialized) return
  const { StripeTerminal, TerminalEventsEnum } = await getTerminal()
  // Token provider: the SDK asks, we fetch from our authed endpoint.
  await StripeTerminal.addListener(TerminalEventsEnum.RequestedConnectionToken, () => {
    void fetchConnectionToken()
      .then((token) => StripeTerminal.setConnectionToken({ token }))
      .catch((err) => console.error('[tap-to-pay] token provider failed:', err))
  })
  const isTest = !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_live_')
  await StripeTerminal.initialize({ isTest })
  _initialized = true
}

/**
 * Discover + connect the phone's built-in reader (Tap to Pay). Requires the
 * platform Terminal Location (server adds it to the connection token).
 */
export async function connectLocalReader(): Promise<void> {
  const { StripeTerminal, TerminalConnectTypes } = await getTerminal()
  const { readers } = await StripeTerminal.discoverReaders({
    type: TerminalConnectTypes.TapToPay,
    locationId: process.env.NEXT_PUBLIC_STRIPE_TERMINAL_LOCATION_ID || undefined,
  })
  if (!readers.length) throw new Error('This phone cannot act as a card reader')
  await StripeTerminal.connectReader({
    reader: readers[0],
    merchantDisplayName: 'Senior Stylist',
  })
}

/**
 * Collect + confirm a card_present PaymentIntent on the connected local reader.
 * The caller then POSTs /api/payments/intent/confirm (idempotent finalize; the
 * payment_intent.succeeded webhook is the backstop if the app dies mid-flow).
 */
export async function collectTerminalPayment(clientSecret: string): Promise<void> {
  const { StripeTerminal } = await getTerminal()
  await StripeTerminal.collectPaymentMethod({ paymentIntent: clientSecret })
  await StripeTerminal.confirmPaymentIntent()
}

export async function disconnectTerminal(): Promise<void> {
  try {
    const { StripeTerminal } = await getTerminal()
    await StripeTerminal.disconnectReader()
  } catch {
    // best-effort
  }
}
