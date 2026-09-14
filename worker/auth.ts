/**
 * Login by wallet signature.
 *
 * 1. The client asks for a challenge. We mint a single-use nonce.
 * 2. Nimiq Pay shows the user a native dialog and signs it.
 * 3. We verify the signature, derive the address from the public key, and
 *    hand back a bearer token.
 *
 * There is no password, no email and no account recovery to get wrong,
 * because the only identity here is "holds the key to this Nimiq address".
 */

import { verifyNimiqSignature } from '../shared/nimiq-signature.js'
import { ApiError, hashToken, newId, now, type Env } from './util.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** Human-readable so the wallet's approval dialog says something meaningful. */
export function challengeMessage(nonce: string): string {
  return `Sign in to Loop\n\nThis proves you hold this Nimiq address. It is not a payment and moves no funds.\n\nCode: ${nonce}`
}

export async function createChallenge(env: Env): Promise<{ nonce: string; message: string }> {
  const nonce = newId(16)
  const created = now()
  await env.DB.prepare('INSERT INTO challenges (nonce, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(nonce, created, created + CHALLENGE_TTL_MS)
    .run()

  // Opportunistic cleanup; cheap, and keeps the table from growing forever.
  await env.DB.prepare('DELETE FROM challenges WHERE expires_at < ?').bind(created).run()

  return { nonce, message: challengeMessage(nonce) }
}

export interface LoginResult {
  token: string
  address: string
  displayName: string
  avatarSeed: number
  isNewUser: boolean
}

export async function login(
  env: Env,
  nonce: string,
  publicKeyHex: string,
  signatureHex: string,
  claimedAddress: string | undefined,
  suggestedName: string | undefined,
): Promise<LoginResult> {
  const row = await env.DB.prepare('SELECT nonce, expires_at FROM challenges WHERE nonce = ?')
    .bind(nonce)
    .first<{ nonce: string; expires_at: number }>()

  if (!row) throw new ApiError(401, 'That sign-in code has already been used. Try again.', 'bad_challenge')

  // Single use, whatever happens next.
  await env.DB.prepare('DELETE FROM challenges WHERE nonce = ?').bind(nonce).run()

  if (row.expires_at < now()) {
    throw new ApiError(401, 'That sign-in code expired. Try again.', 'expired_challenge')
  }

  const verified = verifyNimiqSignature(challengeMessage(nonce), publicKeyHex, signatureHex)
  if (!verified) throw new ApiError(401, 'We could not verify that signature.', 'bad_signature')

  // The address comes from the key, never from the request body. If the client
  // also told us an address, it had better be the same one.
  if (claimedAddress && claimedAddress.replace(/\s/g, '').toUpperCase() !== verified.address) {
    throw new ApiError(401, 'That signature does not match that address.', 'address_mismatch')
  }

  const address = verified.address
  const ts = now()
  const existing = await env.DB.prepare('SELECT address, display_name, avatar_seed FROM users WHERE address = ?')
    .bind(address)
    .first<{ address: string; display_name: string; avatar_seed: number }>()

  let displayName: string
  let avatarSeed: number
  const isNewUser = !existing

  if (existing) {
    displayName = existing.display_name
    avatarSeed = existing.avatar_seed
    await env.DB.prepare('UPDATE users SET last_seen_at = ?, public_key = ? WHERE address = ?')
      .bind(ts, verified.publicKeyHex, address)
      .run()
  } else {
    displayName = (suggestedName ?? '').trim().slice(0, 40) || defaultName(address)
    avatarSeed = seedFromAddress(address)
    await env.DB.prepare(
      'INSERT INTO users (address, display_name, avatar_seed, public_key, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(address, displayName, avatarSeed, verified.publicKeyHex, ts, ts)
      .run()
  }

  const token = newId(32)
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, address, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(hashToken(token), address, ts, ts + SESSION_TTL_MS)
    .run()

  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(ts).run()

  return { token, address, displayName, avatarSeed, isNewUser }
}

/** A friendly placeholder until the user picks a name: the last four characters. */
function defaultName(address: string): string {
  return `NQ…${address.slice(-4)}`
}

/** Stable colour per address, so the same person is the same colour everywhere. */
function seedFromAddress(address: string): number {
  let h = 0
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0
  return h % 8
}

export interface AuthedUser {
  address: string
  displayName: string
  avatarSeed: number
}

/** Resolve the bearer token on a request, or throw 401. */
export async function requireUser(env: Env, request: Request): Promise<AuthedUser> {
  const header = request.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new ApiError(401, 'Sign in to continue.', 'no_token')

  const row = await env.DB.prepare(
    `SELECT s.address, s.expires_at, u.display_name, u.avatar_seed
       FROM sessions s JOIN users u ON u.address = s.address
      WHERE s.token_hash = ?`,
  )
    .bind(hashToken(token))
    .first<{ address: string; expires_at: number; display_name: string; avatar_seed: number }>()

  if (!row) throw new ApiError(401, 'Your session has expired. Sign in again.', 'bad_token')
  if (row.expires_at < now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hashToken(token)).run()
    throw new ApiError(401, 'Your session has expired. Sign in again.', 'expired_token')
  }

  return { address: row.address, displayName: row.display_name, avatarSeed: row.avatar_seed }
}
