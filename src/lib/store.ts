/**
 * App state. Small enough that a handful of refs beats a state library.
 */

import { computed, reactive, ref } from 'vue'
import {
  api,
  ApiError,
  getToken,
  setToken,
  type Member,
  type Plan,
  type Stats,
  type TabSummary,
} from './api.js'
import { signMessage, toFriendlyError, userLanguage } from './nimiq.js'

export type Screen = 'welcome' | 'home' | 'tab' | 'settle' | 'activity' | 'profile'

export const session = reactive({
  address: null as string | null,
  displayName: '' as string,
  avatarSeed: 0,
  isNewUser: false,
})

export const signedIn = computed(() => session.address !== null)

export const screen = ref<Screen>('welcome')
export const activeTabId = ref<string | null>(null)
export const pendingInviteCode = ref<string | null>(null)

export const tabs = ref<TabSummary[]>([])
export const plan = ref<Plan | null>(null)
export const knownMembers = ref<Member[]>([])
export const stats = ref<Stats | null>(null)

export const booting = ref(true)
export const signingIn = ref(false)
export const globalError = ref<string | null>(null)
export const toast = ref<{ text: string; tone: 'good' | 'bad' | 'info' } | null>(null)

let toastTimer: number | undefined

export function showToast(text: string, tone: 'good' | 'bad' | 'info' = 'info'): void {
  toast.value = { text, tone }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = null
  }, 4000)
}

export function mergeMembers(incoming: Member[]): void {
  const byAddress = new Map(knownMembers.value.map((m) => [m.address, m]))
  for (const m of incoming) byAddress.set(m.address, m)
  knownMembers.value = [...byAddress.values()]
}

/** Price of one NIM in the user's currency, refreshed lazily. */
export const nimPrice = ref<{ currency: string; rate: number | null; stale: boolean }>({
  currency: 'usd',
  rate: null,
  stale: false,
})

export async function refreshPrice(): Promise<void> {
  try {
    const result = await api.price(nimPrice.value.currency)
    nimPrice.value = { currency: result.currency, rate: result.rate, stale: result.stale }
  } catch {
    // A missing price is not an error worth showing. NIM-only entry still works.
  }
}

/**
 * Sign in: ask the server for a nonce, have the wallet sign it, trade the
 * signature for a session.
 *
 * Exactly ONE native dialog, behind a deliberate tap. We deliberately do not
 * also call `listAccounts()` — the signature already proves which address the
 * user holds the key for, and the server derives it from the public key
 * rather than trusting anything we send. A second dialog would ask the user
 * to approve something we already know.
 */
export async function signIn(): Promise<void> {
  if (signingIn.value) return
  signingIn.value = true
  globalError.value = null
  try {
    const { nonce, message } = await api.challenge()
    const signed = await signMessage(message)

    const result = await api.login({
      nonce,
      publicKey: signed.publicKey,
      signature: signed.signature,
    })

    setToken(result.token)
    session.address = result.address
    session.displayName = result.displayName
    session.avatarSeed = result.avatarSeed
    session.isNewUser = result.isNewUser

    await refreshAll()
    screen.value = 'home'
    // An invite in the launch URL takes you straight to that tab.
    if (pendingInviteCode.value) await consumePendingInvite()
  } catch (err) {
    const friendly = toFriendlyError(err)
    if (friendly.name === 'UserRejectedError') {
      globalError.value = 'Sign-in needs your approval in the wallet. Tap Sign in to try again.'
    } else {
      globalError.value = friendly.message
    }
  } finally {
    signingIn.value = false
  }
}

export function signOut(): void {
  setToken(null)
  session.address = null
  session.displayName = ''
  tabs.value = []
  plan.value = null
  screen.value = 'welcome'
}

export async function refreshAll(): Promise<void> {
  const [tabResult, meResult] = await Promise.allSettled([api.tabs(), api.me()])
  if (tabResult.status === 'fulfilled') tabs.value = tabResult.value.tabs
  if (meResult.status === 'fulfilled') {
    plan.value = meResult.value.plan
    session.displayName = meResult.value.user.displayName
    session.avatarSeed = meResult.value.user.avatarSeed
    mergeMembers(meResult.value.members)
  }
  if (tabResult.status === 'rejected' && tabResult.reason instanceof ApiError) {
    if (tabResult.reason.isAuthError) signOut()
    else globalError.value = tabResult.reason.message
  }
}

/** Pick up `?join=CODE` from the launch URL so an invite link lands somewhere useful. */
export function captureInviteFromUrl(): void {
  try {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('join') ?? params.get('invite')
    if (code) {
      pendingInviteCode.value = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
      // Clean the URL so a refresh does not re-trigger the join.
      window.history.replaceState({}, '', window.location.pathname)
    }
  } catch {
    // A hostile URL is not worth crashing over.
  }
}

export async function consumePendingInvite(): Promise<void> {
  const code = pendingInviteCode.value
  if (!code || !session.address) return
  pendingInviteCode.value = null
  try {
    const result = await api.joinTab(code)
    await refreshAll()
    activeTabId.value = result.id
    screen.value = 'tab'
    showToast(result.alreadyMember ? `You're already in ${result.name}` : `Joined ${result.name}`, 'good')
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'That invite did not work.', 'bad')
  }
}

export async function boot(): Promise<void> {
  captureInviteFromUrl()
  void refreshPrice()
  void api
    .stats()
    .then((s) => {
      stats.value = s
    })
    .catch(() => {})

  if (getToken()) {
    try {
      const me = await api.me()
      session.address = me.user.address
      session.displayName = me.user.displayName
      session.avatarSeed = me.user.avatarSeed
      plan.value = me.plan
      mergeMembers(me.members)
      screen.value = 'home'
      void api
        .tabs()
        .then((t) => {
          tabs.value = t.tabs
        })
        .catch(() => {})
      if (pendingInviteCode.value) await consumePendingInvite()
    } catch (err) {
      if (err instanceof ApiError && err.isAuthError) setToken(null)
      screen.value = 'welcome'
    }
  }
  booting.value = false
}

export const language = userLanguage()
