// P55 — THE phone normalizer. Every phone comparison in the portal identity
// layer (login lookup, signup dedupe, tier-1 poaPhone matching, recipients
// dedupe, the portal_accounts_phone_digits_uniq index) uses digits-only
// normalization so "(555) 123-4567", "555.123.4567" and "5551234567" are the
// same identity. Deliberately NOT E.164 (no country-code inference — sendSms
// has none either); Twilio rejects junk and sendSms swallows it.

export function normalizePhoneDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/** True when the string contains enough digits to plausibly be a phone. */
export function looksLikePhone(value: string | null | undefined): boolean {
  return normalizePhoneDigits(value).length >= 7
}
