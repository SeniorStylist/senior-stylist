/**
 * P52 — privacy mask for names shown to unauthenticated signup users.
 * Fixed THREE bullets per word regardless of the word's real length
 * ("Jane Gerhardt" → "J••• G•••") so the mask never leaks name length.
 * Single-character words still render as "X•••".
 */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0].toUpperCase()}•••`)
    .join(' ')
}
