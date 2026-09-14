import { sha256 } from '@noble/hashes/sha2.js'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
}

/** URL-safe random id. 16 bytes is plenty and keeps it short enough to read aloud. */
export function newId(bytes = 16): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Invite codes people have to type or say out loud, so: no vowels (nothing
 * spells anything unfortunate), and no 0/O/1/I/L lookalikes.
 */
const INVITE_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ'

export function newInviteCode(length = 6): string {
  const buf = new Uint8Array(length)
  crypto.getRandomValues(buf)
  let out = ''
  for (const b of buf) out += INVITE_ALPHABET[b % INVITE_ALPHABET.length]
  return out
}

export function hashToken(token: string): string {
  const bytes = sha256(new TextEncoder().encode(token))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function now(): number {
  return Date.now()
}

/** Clamp and clean any string that came from a user before it hits the database. */
export function cleanText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return ''
  // Strip control characters; keep everything else, including emoji and scripts
  // we have never heard of.
  return input
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, maxLength)
}

/** Parse an integer luna amount, rejecting anything that is not a sane positive integer. */
export function parseLuna(input: unknown): number | null {
  const n = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(n)) return null
  if (!Number.isInteger(n)) return null
  if (n <= 0) return null
  // 21 billion NIM in luna, comfortably above total supply — anything larger is
  // someone poking at us.
  if (n > 2_100_000_000_000_000) return null
  return n
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}
