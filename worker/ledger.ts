/**
 * Turning stored rows into live balances.
 *
 * The only thing we persist is what actually happened: expenses, and real NIM
 * payments. Netting and ring-cancellation are recomputed on every read.
 *
 * That is a deliberate choice. A "cancelled" ring is a statement about the
 * current state of the graph, not a transaction — if somebody adds a dinner an
 * hour later, the ring should quietly re-form and Loop should say so. Storing
 * the netting as rows would let the stored answer drift away from the real one,
 * and the first time that happens somebody loses money and stops trusting the
 * app. Recomputing costs a few milliseconds and can never be wrong.
 *
 * A confirmed payment is folded in as a debt pointing the other way, which is
 * exactly what a payment is: I owed you 300, I paid you 300, now you owe me 300
 * against the original — net zero.
 */

import { allocateAcrossTabs, buildSettlementPlan, expenseToDebts, rebalanceWithinTab } from '../shared/netting.js'
import type { CancelledCycle, Debt, SettlementPlan } from '../shared/types.js'
import type { Env } from './util.js'

export interface TabDebts {
  tabId: string
  /** After this tab has been rebalanced down to the fewest transfers. */
  debts: Debt[]
  /** Before any netting: one obligation per person per expense. The honest
   *  baseline for "this is what you would be doing without Loop". */
  rawDebts: Debt[]
}

interface ExpenseRow {
  id: string
  tab_id: string
  payer: string
  address: string
  share_luna: number
}

interface TransferRow {
  tab_id: string | null
  from_addr: string
  to_addr: string
  amount_luna: number
}

/**
 * Every obligation inside one tab, after that tab has been rebalanced down to
 * the fewest transfers. Payments already made are folded in first.
 */
export async function tabDebts(env: Env, tabId: string): Promise<Debt[]> {
  const raw = await rawTabDebts(env, tabId)
  return rebalanceWithinTab(raw)
}

async function rawTabDebts(env: Env, tabId: string): Promise<Debt[]> {
  const { results: shareRows } = await env.DB.prepare(
    `SELECT e.id, e.tab_id, e.payer, s.address, s.share_luna
       FROM expenses e JOIN expense_shares s ON s.expense_id = e.id
      WHERE e.tab_id = ? AND e.voided = 0`,
  )
    .bind(tabId)
    .all<ExpenseRow>()

  const { results: transferRows } = await env.DB.prepare(
    `SELECT tab_id, from_addr, to_addr, amount_luna
       FROM transfers
      WHERE tab_id = ? AND status = 'confirmed'`,
  )
    .bind(tabId)
    .all<TransferRow>()

  return assembleDebts(shareRows ?? [], transferRows ?? [])
}

function assembleDebts(shareRows: ExpenseRow[], transferRows: TransferRow[]): Debt[] {
  const byExpense = new Map<string, { payer: string; shares: Array<{ address: string; shareLuna: number }> }>()
  for (const row of shareRows) {
    let entry = byExpense.get(row.id)
    if (!entry) {
      entry = { payer: row.payer, shares: [] }
      byExpense.set(row.id, entry)
    }
    entry.shares.push({ address: row.address, shareLuna: row.share_luna })
  }

  const debts: Debt[] = []
  for (const entry of byExpense.values()) {
    debts.push(...expenseToDebts(entry.payer, entry.shares))
  }
  // A payment is a debt pointing the other way.
  for (const t of transferRows) {
    debts.push({ from: t.to_addr, to: t.from_addr, amountLuna: t.amount_luna })
  }
  return debts
}

/**
 * Which tabs could possibly matter to this user?
 *
 * A debt ring can run through a tab the user has never heard of: you owe Bea
 * for the flat, Bea owes Cal for a ski trip you were not on, Cal owes you for
 * lunch. Nobody can see that ring from inside their own tabs — which is
 * precisely why an app that can see it is worth having.
 *
 * So we walk outwards from the user: their tabs, the people in those tabs,
 * those people's tabs, and so on, until the set stops growing. That is the
 * connected component of the money graph the user sits in, and a ring
 * involving them cannot leave it.
 *
 * The walk is capped. If somebody's component ever spans more tabs than the
 * cap, we fall back to their own tabs: fewer rings found, never a wrong
 * balance, and no request that runs away with itself.
 */
const COMPONENT_TAB_LIMIT = 400

export async function componentTabIds(env: Env, address: string): Promise<string[]> {
  const seenTabs = new Set<string>()
  const seenPeople = new Set<string>([address])
  let frontier = [address]

  for (let depth = 0; depth < 6 && frontier.length > 0; depth++) {
    const placeholders = frontier.map(() => '?').join(',')
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT tab_id FROM tab_members WHERE address IN (${placeholders})`,
    )
      .bind(...frontier)
      .all<{ tab_id: string }>()

    const newTabs: string[] = []
    for (const row of results ?? []) {
      if (!seenTabs.has(row.tab_id)) {
        seenTabs.add(row.tab_id)
        newTabs.push(row.tab_id)
      }
    }
    if (seenTabs.size > COMPONENT_TAB_LIMIT) return ownTabIds(env, address)
    if (newTabs.length === 0) break

    const tabPlaceholders = newTabs.map(() => '?').join(',')
    const { results: people } = await env.DB.prepare(
      `SELECT DISTINCT address FROM tab_members WHERE tab_id IN (${tabPlaceholders})`,
    )
      .bind(...newTabs)
      .all<{ address: string }>()

    frontier = []
    for (const row of people ?? []) {
      if (!seenPeople.has(row.address)) {
        seenPeople.add(row.address)
        frontier.push(row.address)
      }
    }
  }

  return [...seenTabs]
}

async function ownTabIds(env: Env, address: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT tab_id FROM tab_members WHERE address = ?')
    .bind(address)
    .all<{ tab_id: string }>()
  return (results ?? []).map((r) => r.tab_id)
}

/** Everyone this user actually shares a tab with. Used to decide what they may see. */
export async function coMembers(env: Env, address: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT address FROM tab_members
      WHERE tab_id IN (SELECT tab_id FROM tab_members WHERE address = ?)`,
  )
    .bind(address)
    .all<{ address: string }>()
  return new Set((results ?? []).map((r) => r.address))
}

/** Every tab in a set, each already rebalanced on its own. */
export async function debtsForTabs(env: Env, tabIds: string[], address: string): Promise<TabDebts[]> {
  if (tabIds.length === 0) return []
  const placeholders = tabIds.map(() => '?').join(',')

  const { results: shareRows } = await env.DB.prepare(
    `SELECT e.id, e.tab_id, e.payer, s.address, s.share_luna
       FROM expenses e
       JOIN expense_shares s ON s.expense_id = e.id
      WHERE e.voided = 0 AND e.tab_id IN (${placeholders})`,
  )
    .bind(...tabIds)
    .all<ExpenseRow>()

  const { results: transferRows } = await env.DB.prepare(
    `SELECT tab_id, from_addr, to_addr, amount_luna
       FROM transfers
      WHERE status = 'confirmed'
        AND (tab_id IN (${placeholders}) OR (tab_id IS NULL AND (from_addr = ? OR to_addr = ?)))`,
  )
    .bind(...tabIds, address, address)
    .all<TransferRow>()

  const byTab = new Map<string, { shares: ExpenseRow[]; transfers: TransferRow[] }>()
  const bucket = (tabId: string) => {
    let b = byTab.get(tabId)
    if (!b) {
      b = { shares: [], transfers: [] }
      byTab.set(tabId, b)
    }
    return b
  }

  for (const row of shareRows ?? []) bucket(row.tab_id).shares.push(row)
  for (const row of transferRows ?? []) {
    // A payment we could not attribute to a tab (rare, only when a race moved
    // the balance under us) sits in its own bucket so it still counts.
    bucket(row.tab_id ?? '__unattributed__').transfers.push(row)
  }

  const out: TabDebts[] = []
  for (const [tabId, b] of byTab) {
    const raw = assembleDebts(b.shares, b.transfers)
    const rebalanced = tabId === '__unattributed__' ? raw : rebalanceWithinTab(raw)
    if (rebalanced.length > 0 || raw.length > 0) {
      out.push({ tabId, debts: rebalanced, rawDebts: raw })
    }
  }
  return out
}

export interface UserPlan extends SettlementPlan {
  /** Just the payments this user has to make. */
  youOwe: Debt[]
  /** Just the payments coming to this user. */
  owedToYou: Debt[]
  /** Rings this user is personally part of, with strangers masked. */
  yourCycles: CancelledCycle[]
  /** Placeholder identities for ring members the user does not share a tab with. */
  maskedMembers: Array<{ address: string; displayName: string; avatarSeed: number }>
}

/**
 * The user's own view of the global plan.
 *
 * We compute over the whole connected component — that is the only way to see
 * a ring — and then hand back strictly the part that belongs to this person.
 * Other people's debts never leave the Worker.
 *
 * A long ring can pass through somebody the user has never shared a tab with.
 * Their address is replaced with a placeholder so the ring is still legible
 * without handing out a stranger's identity or their balances.
 */
export async function planForUser(env: Env, address: string): Promise<UserPlan> {
  const tabIds = await componentTabIds(env, address)
  const tabs = await debtsForTabs(env, tabIds, address)
  const plan = buildSettlementPlan(tabs)

  const youOwe = plan.debts.filter((d) => d.from === address)
  const owedToYou = plan.debts.filter((d) => d.to === address)
  const rawCycles = plan.cancelledCycles.filter((c) => c.members.includes(address))

  // How many separate payments this user would be making without Loop: one
  // per obligation, before any netting, counted only where they are involved.
  let rawPaymentCount = 0
  for (const tab of tabs) {
    for (const d of tab.rawDebts) {
      if (d.amountLuna > 0 && (d.from === address || d.to === address)) rawPaymentCount++
    }
  }

  const visible = await coMembers(env, address)
  const masks = new Map<string, string>()
  const maskedMembers: Array<{ address: string; displayName: string; avatarSeed: number }> = []

  const maskFor = (who: string): string => {
    if (visible.has(who)) return who
    let alias = masks.get(who)
    if (!alias) {
      alias = `~someone-${masks.size + 1}`
      masks.set(who, alias)
      maskedMembers.push({
        address: alias,
        displayName: 'Someone else',
        avatarSeed: 4 + (masks.size % 4),
      })
    }
    return alias
  }

  const yourCycles = rawCycles.map((c) => ({
    members: c.members.map(maskFor),
    amountLuna: c.amountLuna,
  }))

  let cancelledLuna = 0
  for (const c of rawCycles) cancelledLuna += c.amountLuna * c.members.length

  return {
    debts: [...youOwe, ...owedToYou],
    cancelledCycles: yourCycles,
    rawPaymentCount,
    cancelledLuna,
    youOwe,
    owedToYou,
    yourCycles,
    maskedMembers,
  }
}

/** The global ring log, for stats. Separate from what any one user may see. */
export async function globalCycles(env: Env, address: string): Promise<CancelledCycle[]> {
  const tabIds = await componentTabIds(env, address)
  const tabs = await debtsForTabs(env, tabIds, address)
  return buildSettlementPlan(tabs).cancelledCycles
}

/**
 * Which tabs does a payment from A to B actually clear, and by how much?
 *
 * Called once, at the moment a payment is confirmed. We look at the per-tab
 * rebalanced plans the payment was quoted from and drain the biggest tab
 * first. Anything we cannot attribute (because somebody added an expense
 * between the quote and the confirmation) lands on a tab-less row so the
 * money still counts — it just does not show inside a specific tab.
 */
export async function allocateSettlement(
  env: Env,
  from: string,
  to: string,
  amountLuna: number,
): Promise<Array<{ tabId: string | null; amountLuna: number }>> {
  // Only tabs the payer is actually in can hold a debt they are settling.
  const tabs = await debtsForTabs(env, await ownTabIds(env, from), from)

  const perTab: Array<{ tabId: string; amountLuna: number }> = []
  for (const tab of tabs) {
    if (tab.tabId === '__unattributed__') continue
    let total = 0
    for (const d of tab.debts) {
      if (d.from === from && d.to === to) total += d.amountLuna
    }
    if (total > 0) perTab.push({ tabId: tab.tabId, amountLuna: total })
  }

  const allocated = allocateAcrossTabs(perTab, amountLuna)
  const assigned = allocated.reduce((sum, a) => sum + a.amountLuna, 0)
  const out: Array<{ tabId: string | null; amountLuna: number }> = allocated.map((a) => ({
    tabId: a.tabId,
    amountLuna: a.amountLuna,
  }))
  if (assigned < amountLuna) out.push({ tabId: null, amountLuna: amountLuna - assigned })
  return out
}

/** Stable identity for a debt ring, so spotting it twice logs it once. */
export function ringKey(cycle: CancelledCycle): string {
  const rotated = rotateToSmallest(cycle.members)
  return `${rotated.join('>')}@${cycle.amountLuna}`
}

function rotateToSmallest(members: string[]): string[] {
  if (members.length === 0) return members
  let best = 0
  for (let i = 1; i < members.length; i++) {
    if (members[i] < members[best]) best = i
  }
  return [...members.slice(best), ...members.slice(0, best)]
}
