/**
 * Everything that touches Nimiq Pay.
 *
 * Two rules run through this file:
 *
 *  1. The app must stay usable outside Nimiq Pay. Somebody will open the link
 *     in Safari. They should get a clear explanation and a working preview,
 *     not a spinner that never stops.
 *
 *  2. Provider calls can fail two different ways — a thrown error, or a
 *     resolved `{ error: { ... } }` object. Both are handled in one place,
 *     `unwrap()`, so no feature has to remember.
 */

import { getHostLanguage, init, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { ref } from 'vue'

const INIT_TIMEOUT_MS = 10_000

export const providerState = ref<'connecting' | 'ready' | 'unavailable'>('connecting')

let providerPromise: Promise<NimiqProvider | null> | null = null
let resolvedProvider: NimiqProvider | null = null

/**
 * Start looking for the wallet immediately, but never let that block the UI.
 * Resolves to null outside Nimiq Pay rather than rejecting, because "not in
 * the wallet" is an ordinary state, not an error.
 */
export function startProviderDetection(): Promise<NimiqProvider | null> {
  if (providerPromise) return providerPromise
  providerPromise = init({ timeout: INIT_TIMEOUT_MS })
    .then((provider) => {
      resolvedProvider = provider
      providerState.value = 'ready'
      return provider
    })
    .catch(() => {
      providerState.value = 'unavailable'
      return null
    })
  return providerPromise
}

export async function getProvider(): Promise<NimiqProvider> {
  const provider = resolvedProvider ?? (await startProviderDetection())
  if (!provider) throw new NimiqUnavailableError()
  return provider
}

export class NimiqUnavailableError extends Error {
  constructor() {
    super('Open this in Nimiq Pay to use your wallet.')
    this.name = 'NimiqUnavailableError'
  }
}

/** The user tapped Cancel on a native dialog. Not a failure — just a no. */
export class UserRejectedError extends Error {
  constructor(message = 'You cancelled that.') {
    super(message)
    this.name = 'UserRejectedError'
  }
}

interface MaybeErrorResponse {
  error?: { type?: string; message?: string }
}

/**
 * Normalise a provider result. The provider sometimes resolves with an error
 * object instead of rejecting, and the user-rejection case has to be told
 * apart from a genuine fault so the UI can stay calm about it.
 */
function unwrap<T>(result: T | MaybeErrorResponse): T {
  if (result && typeof result === 'object' && 'error' in result) {
    const error = (result as MaybeErrorResponse).error
    const type = error?.type ?? ''
    const message = error?.message ?? 'The wallet could not complete that.'
    if (isRejection(type, message)) throw new UserRejectedError()
    throw new Error(message)
  }
  return result as T
}

function isRejection(type: string, message: string): boolean {
  const haystack = `${type} ${message}`.toLowerCase()
  return (
    haystack.includes('permissiondenied') ||
    haystack.includes('permission denied') ||
    haystack.includes('rejected') ||
    haystack.includes('denied') ||
    haystack.includes('cancel') ||
    haystack.includes('abort')
  )
}

/** Turn any thrown provider error into something we can show a person. */
export function toFriendlyError(err: unknown): Error {
  if (err instanceof UserRejectedError) return err
  if (err instanceof NimiqUnavailableError) return err
  const message = err instanceof Error ? err.message : String(err)
  if (isRejection('', message)) return new UserRejectedError()
  return new Error(message || 'Something went wrong. Try again.')
}

async function call<T>(fn: (provider: NimiqProvider) => Promise<T | MaybeErrorResponse>): Promise<T> {
  const provider = await getProvider()
  try {
    return unwrap<T>(await fn(provider))
  } catch (err) {
    throw toFriendlyError(err)
  }
}

// ── The calls Loop actually makes ──────────────────────────────────────────

export function signMessage(message: string): Promise<{ publicKey: string; signature: string }> {
  return call<{ publicKey: string; signature: string }>((p) => p.sign(message))
}

export function getBlockNumber(): Promise<number> {
  return call<number>((p) => p.getBlockNumber())
}

export function isConsensusEstablished(): Promise<boolean> {
  return call<boolean>((p) => p.isConsensusEstablished())
}

/**
 * Pay somebody. The memo is attached to the transaction so the recipient can
 * see what it was for in their own wallet history, and so we can reconcile it.
 *
 * The Nimiq data field caps at 64 bytes. We trim by BYTES, not characters —
 * an emoji in a tab name is four bytes and would otherwise silently overflow.
 */
export function sendPayment(recipient: string, valueLuna: number, memo?: string): Promise<string> {
  const trimmed = memo ? trimToBytes(memo, 64) : ''
  if (trimmed) {
    return call<string>((p) =>
      p.sendBasicTransactionWithData({ recipient, value: valueLuna, data: trimmed }),
    )
  }
  return call<string>((p) => p.sendBasicTransaction({ recipient, value: valueLuna }))
}

function trimToBytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(text).length <= maxBytes) return text
  let out = text
  while (out.length > 0 && encoder.encode(out).length > maxBytes) {
    out = out.slice(0, -1)
  }
  return out
}

/** ISO 639-1 code the user picked in Nimiq Pay, falling back to the browser. */
export function userLanguage(): string {
  return getHostLanguage() ?? navigator.language.split('-')[0] ?? 'en'
}
