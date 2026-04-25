import { randomBytes, timingSafeEqual } from 'node:crypto'
import { webcrypto } from 'node:crypto'

const ITERATIONS = 210_000
const SALT_LEN = 16
const HASH_LEN = 32

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number, hashLen: number): Promise<Uint8Array> {
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new Uint8Array(salt), hash: 'SHA-256', iterations },
    key,
    hashLen * 8,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const hash = await pbkdf2(plain, salt, ITERATIONS, HASH_LEN)
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(hash)}`
}

export async function verifyPassword(plain: string, encoded: string | null | undefined): Promise<boolean> {
  if (!encoded) return false
  const parts = encoded.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iter = Number(parts[1])
  if (!Number.isFinite(iter) || iter < 1) return false
  const salt = fromHex(parts[2])
  const expected = fromHex(parts[3])
  const computed = await pbkdf2(plain, salt, iter, expected.length)
  if (computed.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(computed), Buffer.from(expected))
}
