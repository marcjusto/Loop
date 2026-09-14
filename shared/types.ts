/**
 * Shared types between the Worker API and the Vue frontend.
 *
 * Money is ALWAYS an integer number of luna (1 NIM = 100_000 luna). Floating
 * point never touches a balance — it is only used to render a fiat estimate.
 */

export const LUNA_PER_NIM = 100_000

export interface Member {
  address: string
  displayName: string
  avatarSeed: number
}

export type SplitMode = 'equal' | 'exact' | 'shares'

export interface ExpenseShare {
  address: string
  shareLuna: number
}

export interface Expense {
  id: string
  tabId: string
  payer: string
  amountLuna: number
  description: string
  category: string
  fiatCurrency: string | null
  fiatAmount: number | null
  fiatRate: number | null
  createdBy: string
  createdAt: number
  shares: ExpenseShare[]
}

export type TransferKind = 'settlement' | 'loop'
export type TransferStatus = 'pending' | 'confirmed' | 'failed' | 'cancelled'

export interface Transfer {
  id: string
  kind: TransferKind
  fromAddr: string
  toAddr: string
  amountLuna: number
  tabId: string | null
  txHash: string | null
  blockHeight: number | null
  status: TransferStatus
  loopRunId: string | null
  createdAt: number
}

export interface Tab {
  id: string
  name: string
  emoji: string
  inviteCode: string
  createdBy: string
  createdAt: number
  archived: boolean
  members: Member[]
}

/** One directed debt: `from` owes `to` `amountLuna`. Always positive. */
export interface Debt {
  from: string
  to: string
  amountLuna: number
}

/** A closed debt cycle that Loop cancelled. Nobody pays; the ring evaporates. */
export interface CancelledCycle {
  /** Addresses in cycle order. members[i] owed members[i+1], and last owed first. */
  members: string[]
  amountLuna: number
}

export interface SettlementPlan {
  /** Payments the user still has to make after netting. */
  debts: Debt[]
  /** Cycles Loop cancelled to get here. */
  cancelledCycles: CancelledCycle[]
  /** Payment count before netting (raw pairwise obligations). */
  rawPaymentCount: number
  /** Total luna that vanished because it went around in a circle. */
  cancelledLuna: number
}
