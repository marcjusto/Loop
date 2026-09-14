/**
 * These tests check our pure-JS Nimiq implementations against the real
 * @nimiq/core WASM library. @nimiq/core is a devDependency used only here —
 * it never ships to the Worker or the browser bundle.
 */
import { describe, expect, it } from 'vitest'
import * as Nimiq from '@nimiq/core'
import {
  addressToUserFriendly,
  isValidAddress,
  normalizeAddress,
  prettyAddress,
  publicKeyToAddress,
  userFriendlyToAddress,
} from '../shared/nimiq-address.js'
import { prefixMessage, verifyNimiqSignature } from '../shared/nimiq-signature.js'
import { sha256 } from '@noble/hashes/sha2.js'

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}
function bytesToHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** Sign a message exactly the way Nimiq Pay's `sign()` does. */
function signLikeNimiqPay(kp: Nimiq.KeyPair, message: string) {
  const signature = kp.sign(sha256(prefixMessage(message)))
  return { publicKey: kp.publicKey.toHex(), signature: signature.toHex() }
}

describe('address derivation', () => {
  it('matches @nimiq/core for 200 random keys', () => {
    for (let i = 0; i < 200; i++) {
      const kp = Nimiq.KeyPair.generate()
      const expected = kp.toAddress().toUserFriendlyAddress()
      expect(publicKeyToAddress(hexToBytes(kp.publicKey.toHex()))).toBe(expected)
    }
  })

  it('round-trips the user-friendly form', () => {
    for (let i = 0; i < 200; i++) {
      const kp = Nimiq.KeyPair.generate()
      const friendly = kp.toAddress().toUserFriendlyAddress()
      const bytes = userFriendlyToAddress(friendly)
      expect(bytesToHex(bytes)).toBe(kp.toAddress().toHex().toLowerCase())
      expect(addressToUserFriendly(bytes)).toBe(friendly)
    }
  })

  it('accepts an address with or without spaces, and lowercase', () => {
    const kp = Nimiq.KeyPair.generate()
    const friendly = kp.toAddress().toUserFriendlyAddress()
    expect(normalizeAddress(friendly)).toBe(friendly.replace(/\s/g, ''))
    expect(normalizeAddress(friendly.replace(/\s/g, ''))).toBe(friendly.replace(/\s/g, ''))
    expect(normalizeAddress(friendly.toLowerCase())).toBe(friendly.replace(/\s/g, ''))
    expect(prettyAddress(normalizeAddress(friendly))).toBe(friendly)
  })

  it('rejects rubbish instead of inventing an address', () => {
    expect(isValidAddress('')).toBe(false)
    expect(isValidAddress('hello')).toBe(false)
    expect(isValidAddress('NQ00 0000')).toBe(false)
    // Valid shape, broken checksum (last character bumped).
    const kp = Nimiq.KeyPair.generate()
    const friendly = kp.toAddress().toUserFriendlyAddress().replace(/\s/g, '')
    const broken = `${friendly.slice(0, -1)}${friendly.slice(-1) === '0' ? '1' : '0'}`
    expect(isValidAddress(broken)).toBe(false)
    // Letters Nimiq's alphabet deliberately excludes.
    expect(isValidAddress(`${friendly.slice(0, -1)}I`)).toBe(false)
  })

  it('refuses a public key that is the wrong length', () => {
    expect(() => publicKeyToAddress(new Uint8Array(31))).toThrow()
    expect(() => addressToUserFriendly(new Uint8Array(19))).toThrow()
  })
})

describe('signature verification', () => {
  it('accepts a genuine signature and recovers the signer address', () => {
    for (let i = 0; i < 50; i++) {
      const kp = Nimiq.KeyPair.generate()
      const message = `Loop login ${i} — ${Math.random()}`
      const { publicKey, signature } = signLikeNimiqPay(kp, message)
      const result = verifyNimiqSignature(message, publicKey, signature)
      expect(result).not.toBeNull()
      expect(result!.address).toBe(kp.toAddress().toUserFriendlyAddress().replace(/\s/g, ''))
    }
  })

  it('rejects a signature for a different message', () => {
    const kp = Nimiq.KeyPair.generate()
    const { publicKey, signature } = signLikeNimiqPay(kp, 'challenge-one')
    expect(verifyNimiqSignature('challenge-two', publicKey, signature)).toBeNull()
  })

  it('rejects a signature from a different key', () => {
    const kp = Nimiq.KeyPair.generate()
    const impostor = Nimiq.KeyPair.generate()
    const { signature } = signLikeNimiqPay(kp, 'challenge')
    expect(verifyNimiqSignature('challenge', impostor.publicKey.toHex(), signature)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const kp = Nimiq.KeyPair.generate()
    const { publicKey, signature } = signLikeNimiqPay(kp, 'challenge')
    const flipped = `${signature.slice(0, -1)}${signature.slice(-1) === 'a' ? 'b' : 'a'}`
    expect(verifyNimiqSignature('challenge', publicKey, flipped)).toBeNull()
  })

  it('returns null rather than throwing on malformed input', () => {
    expect(verifyNimiqSignature('m', 'not-hex', 'also-not-hex')).toBeNull()
    expect(verifyNimiqSignature('m', '', '')).toBeNull()
    expect(verifyNimiqSignature('m', 'ab', 'cd')).toBeNull()
    expect(verifyNimiqSignature('m', 'abc', 'de')).toBeNull()
    expect(verifyNimiqSignature('m', '00'.repeat(32), 'ff'.repeat(64))).toBeNull()
  })

  it('prefixes the message exactly the way Nimiq does', () => {
    const prefixed = prefixMessage('hello')
    expect(new TextDecoder().decode(prefixed)).toBe('\x16Nimiq Signed Message:\n5hello')
  })

  it('uses the byte length, not the character length, for unicode', () => {
    const prefixed = prefixMessage('héllo')
    expect(new TextDecoder().decode(prefixed)).toBe('\x16Nimiq Signed Message:\n6héllo')
  })
})
