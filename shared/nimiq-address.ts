/**
 * Nimiq address encoding, in pure JS so it runs in a Cloudflare Worker.
 *
 * An address is the first 20 bytes of BLAKE2b-256 over the Ed25519 public
 * key. The human-readable form is Nimiq's own base32 alphabet wrapped in an
 * IBAN-style mod-97-10 checksum.
 *
 * Verified against @nimiq/core over 200 random key pairs: encode, decode and
 * round-trip all agree exactly. See test/nimiq-address.test.ts.
 */

import { blake2b } from '@noble/hashes/blake2.js'

/** Nimiq's base32 alphabet: no I, O, W or Z, so nothing looks like anything else. */
const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'

function toBase32(buf: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of buf) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function fromBase32(str: string): Uint8Array {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of str) {
    const idx = ALPHABET.indexOf(c)
    if (idx < 0) throw new Error(`Invalid character in Nimiq address: ${c}`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

/** IBAN mod-97-10, chunked so we never exceed a safe integer. */
function ibanCheck(str: string): number {
  const num = str
    .split('')
    .map((c) => {
      const code = c.charCodeAt(0)
      return code >= 48 && code <= 57 ? c : (code - 55).toString()
    })
    .join('')
  let tmp = ''
  for (let i = 0; i < Math.ceil(num.length / 6); i++) {
    tmp = (parseInt(tmp + num.substr(i * 6, 6), 10) % 97).toString()
  }
  return parseInt(tmp, 10)
}

/** 20 raw address bytes -> `NQ12 3456 ...` (with spaces). */
export function addressToUserFriendly(bytes: Uint8Array): string {
  if (bytes.length !== 20) throw new Error('A Nimiq address is 20 bytes')
  const base32 = toBase32(bytes)
  const check = `00${98 - ibanCheck(`${base32}NQ00`)}`.slice(-2)
  return `NQ${check}${base32}`.replace(/.{4}/g, '$& ').trim()
}

/** `NQ12 3456 ...` (spaces optional) -> 20 raw address bytes. Throws if the checksum fails. */
export function userFriendlyToAddress(str: string): Uint8Array {
  const s = str.replace(/\s/g, '').toUpperCase()
  if (!s.startsWith('NQ')) throw new Error('A Nimiq address starts with NQ')
  if (s.length !== 36) throw new Error('A Nimiq address is 36 characters')
  if (ibanCheck(s.substr(4) + s.substr(0, 4)) !== 1) throw new Error('Nimiq address checksum failed')
  return fromBase32(s.substr(4))
}

/** True when the string is a well-formed, checksum-valid Nimiq address. */
export function isValidAddress(str: string): boolean {
  try {
    userFriendlyToAddress(str)
    return true
  } catch {
    return false
  }
}

/** Ed25519 public key (32 bytes) -> `NQ...` address. */
export function publicKeyToAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error('An Ed25519 public key is 32 bytes')
  return addressToUserFriendly(blake2b(publicKey, { dkLen: 32 }).slice(0, 20))
}

/**
 * Canonical storage form: uppercase, no spaces. Two spellings of the same
 * address must never become two rows in the database.
 */
export function normalizeAddress(str: string): string {
  const bytes = userFriendlyToAddress(str)
  return addressToUserFriendly(bytes).replace(/\s/g, '')
}

/** Storage form back to the spaced form people read. */
export function prettyAddress(normalized: string): string {
  return normalized.replace(/\s/g, '').replace(/.{4}/g, '$& ').trim()
}
