/**
 * The API client.
 *
 * Every call funnels through `request()`, which turns any failure — a dead
 * network, a 500, an expired session — into a single `ApiError` carrying a
 * sentence the UI can show without editing.
 */

const TOKEN_KEY = 'loop.token'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'error',
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get isAuthError(): boolean {
    return this.status === 401
  }
}

/**
 * localStorage throws in a few places (private windows, blocked site data), so
 * every access is guarded and falls back to memory for the session.
 */
let memoryToken: string | null = null

export function getToken(): string | null {
  if (memoryToken) return memoryToken
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  memoryToken = token
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Memory-only for this session. Nothing else to do.
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { auth?: boolean } = {},
): Promise<T> {
  const auth = options.auth ?? true
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    throw new ApiError(
      0,
      offline
        ? 'You look offline. Loop will pick up where you left off when you reconnect.'
        : 'Could not reach Loop. Check your connection and try again.',
      'network',
    )
  }

  let data: any = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    const message =
      (data && typeof data.error === 'string' && data.error) ||
      'Something went wrong. Try again in a moment.'
    const error = new ApiError(res.status, message, data?.code ?? 'error')
    if (error.isAuthError) setToken(null)
    throw error
  }

  return data as T
}

export const api = {
  challenge: () => request<{ nonce: string; message: string }>('POST', '/auth/challenge', {}, { auth: false }),

  login: (payload: {
    nonce: string
    publicKey: string
    signature: string
    address?: string
    displayName?: string
  }) =>
    request<{
      token: string
      address: string
      displayName: string
      avatarSeed: number
      isNewUser: boolean
    }>('POST', '/auth/login', payload, { auth: false }),

  me: () => request<MeResponse>('GET', '/me'),
  updateName: (displayName: string) => request<{ ok: true }>('PATCH', '/me', { displayName }),

  tabs: () => request<{ tabs: TabSummary[] }>('GET', '/tabs'),
  createTab: (name: string, emoji: string) =>
    request<{ id: string; name: string; emoji: string; inviteCode: string }>('POST', '/tabs', {
      name,
      emoji,
    }),
  joinTab: (inviteCode: string) =>
    request<{ id: string; name: string; emoji: string; alreadyMember: boolean }>('POST', '/tabs/join', {
      inviteCode,
    }),
  tab: (id: string) => request<TabDetail>('GET', `/tabs/${id}`),
  addExpense: (tabId: string, payload: AddExpensePayload) =>
    request<{ id: string }>('POST', `/tabs/${tabId}/expenses`, payload),
  removeExpense: (tabId: string, expenseId: string) =>
    request<{ ok: true }>('DELETE', `/tabs/${tabId}/expenses/${expenseId}`),
  leaveTab: (tabId: string) => request<{ ok: true }>('POST', `/tabs/${tabId}/leave`),

  settle: () => request<SettleResponse>('GET', '/settle'),
  prepareSettlement: (toAddr: string, amountLuna: number) =>
    request<{ batchId: string; recipient: string; amountLuna: number; memo: string }>(
      'POST',
      '/settle/prepare',
      { toAddr, amountLuna },
    ),
  confirmSettlement: (batchId: string, txHash: string, blockHeight: number | null) =>
    request<{ ok: true }>('POST', '/settle/confirm', { batchId, txHash, blockHeight }),
  cancelSettlement: (batchId: string, failed = false) =>
    request<{ ok: true }>('POST', '/settle/cancel', { batchId, failed }),

  activity: () => request<ActivityResponse>('GET', '/activity'),
  stats: () => request<Stats>('GET', '/stats', undefined, { auth: false }),
  price: (currency: string) =>
    request<{ currency: string; rate: number | null; fetchedAt: number | null; stale: boolean }>(
      'GET',
      `/price?currency=${encodeURIComponent(currency)}`,
      undefined,
      { auth: false },
    ),
}

// ── Response shapes ────────────────────────────────────────────────────────

export interface Member {
  address: string
  displayName: string
  avatarSeed: number
}

export interface Debt {
  from: string
  to: string
  amountLuna: number
}

export interface CancelledCycle {
  members: string[]
  amountLuna: number
}

export interface Plan {
  debts: Debt[]
  cancelledCycles: CancelledCycle[]
  rawPaymentCount: number
  cancelledLuna: number
  youOwe: Debt[]
  owedToYou: Debt[]
  yourCycles: CancelledCycle[]
}

export interface MeResponse {
  user: Member
  plan: Plan
  members: Member[]
}

export interface TabSummary {
  id: string
  name: string
  emoji: string
  inviteCode: string
  createdBy: string
  createdAt: number
  archived: boolean
  memberCount: number
  expenseCount: number
  lastActivity: number
  yourNetLuna: number
}

export interface ExpenseView {
  id: string
  payer: string
  amountLuna: number
  description: string
  category: string
  fiatCurrency: string | null
  fiatAmount: number | null
  fiatRate: number | null
  createdBy: string
  createdAt: number
  shares: Array<{ address: string; shareLuna: number }>
}

export interface SettlementView {
  id: string
  fromAddr: string
  toAddr: string
  amountLuna: number
  txHash: string | null
  blockHeight: number | null
  status: string
  createdAt: number
}

export interface TabDetail {
  tab: {
    id: string
    name: string
    emoji: string
    inviteCode: string
    createdBy: string
    createdAt: number
    archived: boolean
  }
  members: Member[]
  expenses: ExpenseView[]
  settlements: SettlementView[]
  debts: Debt[]
  totalSpentLuna: number
}

export interface AddExpensePayload {
  amountLuna: number
  description: string
  category?: string
  payer?: string
  splitMode?: 'equal' | 'exact' | 'shares'
  participants?: string[]
  shares?: Array<{ address: string; shareLuna?: number; weight?: number }>
  fiatCurrency?: string | null
  fiatAmount?: number | null
  fiatRate?: number | null
}

export interface SettleResponse {
  plan: Plan
  members: Member[]
  pending: Array<{ id: string; toAddr: string; amountLuna: number; createdAt: number }>
}

export interface ActivityResponse {
  expenses: Array<{
    id: string
    tabId: string
    tabName: string
    emoji: string
    payer: string
    amountLuna: number
    description: string
    createdAt: number
  }>
  settlements: SettlementView[]
  members: Member[]
}

export interface Stats {
  users: number
  tabs: number
  expenses: number
  trackedLuna: number
  settlements: number
  settledLuna: number
  rings: number
  cancelledLuna: number
}
