/**
 * Verifying a Nimiq Pay `sign()` result, without trusting the client.
 *
 * `nimiq.sign(message)` hands back `{ publicKey, signature }`. What the wallet
 * actually signed is not the raw message — it is a hash of the message under a
 * fixed prefix, which is what stops a mini app from tricking a user into
 * signing something that doubles as a transaction:
 *
 *     digest = SHA-256( "\x16Nimiq Signed Message:\n" + length + message )
 *
 * We accept a signature over that digest, and — belt and braces against the
 * host changing where the hash is applied — also over the prefixed bytes
 * themselves. Both bind to exactly the same message, so accepting either is a
 * compatibility allowance, not a security hole.
 *
 * The address is then derived from the public key rather than taken from the
 * client, so a caller cannot claim an address they do not hold the key for.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { publicKeyToAddress } from './nimiq-address.js'

const SIGNING_PREFIX = '\x16Nimiq Signed Message:\n'

function utf8(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '').trim()
  if (clean.length % 2 !== 0) throw new Error('Hex string has an odd length')
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error('Hex string has invalid characters')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
  return out
}

/** The exact byte string Nimiq wraps a message in before hashing it. */
export function prefixMessage(message: string): Uint8Array {
  const msg = utf8(message)
  const prefix = utf8(SIGNING_PREFIX)
  const len = utf8(String(msg.length))
  const out = new Uint8Array(prefix.length + len.length + msg.length)
  out.set(prefix, 0)
  out.set(len, prefix.length)
  out.set(msg, prefix.length + len.length)
  return out
}

export interface VerifiedSignature {
  /** Address derived from the public key, in canonical no-space form. */
  address: string
  publicKeyHex: string
}

/**
 * Verify a signature over `message` and return the address that produced it,
 * or `null` if anything at all is off. Never throws on bad input — malformed
 * hex from a stranger on the internet is an expected Tuesday, not an incident.
 */
export function verifyNimiqSignature(
  message: string,
  publicKeyHex: string,
  signatureHex: string,
): VerifiedSignature | null {
  let publicKey: Uint8Array
  let signature: Uint8Array
  try {
    publicKey = hexToBytes(publicKeyHex)
    signature = hexToBytes(signatureHex)
  } catch {
    return null
  }
  if (publicKey.length !== 32 || signature.length !== 64) return null

  const prefixed = prefixMessage(message)
  const digest = sha256(prefixed)

  let ok = false
  try {
    ok = ed25519.verify(signature, digest, publicKey)
    if (!ok) ok = ed25519.verify(signature, prefixed, publicKey)
  } catch {
    return null
  }
  if (!ok) return null

  try {
    return { address: publicKeyToAddress(publicKey).replace(/\s/g, ''), publicKeyHex }
  } catch {
    return null
  }
}
