/**
 * The netting engine — the part of Loop that actually does something new.
 *
 * Everything here is pure and works on integer luna. No floats, no rounding,
 * no "close enough". A cent that goes missing in a group of friends is a
 * bug report; a luna that goes missing is the same bug with more decimals.
 *
 * Two ideas, in order:
 *
 *  1. PAIR NETTING. Twelve dinners between five people produce dozens of
 *     little obligations. Most of them point at each other. Collapse every
 *     pair down to one number and the pile shrinks hard.
 *
 *  2. CYCLE CANCELLATION. If you owe Bea, Bea owes Cal, and Cal owes you,
 *     the smallest of those three debts is imaginary. It can be deleted from
 *     all three at once and nobody is worse off by a single luna.
 *
 *  3. IN-TAB REBALANCING. Inside one tab everyone is already in a shared
 *     money relationship, so it is fair game to say "B pays A 300" instead of
 *     "B pays A 200, B pays C 100, C pays A 100". Every net position is
 *     identical; there are simply fewer transfers.
 *
 * The rule we will not break: rebalancing stays INSIDE a tab. Across tabs we
 * only ever cancel closed cycles, which reduces existing debts and never
 * points you at a stranger. Loop will not tell you to pay someone you have
 * never shared a bill with. That is what makes "we cancelled 7,400 NIM"
 * something you can show a group of friends without an argument breaking out.
 */

import type { CancelledCycle, Debt, SettlementPlan } from './types.js'

/** `from|to` key for a directed edge. */
function edgeKey(from: string, to: string): string {
  return `${from}|${to}`
}

/**
 * Collapse a list of raw obligations into at most one directed edge per
 * ordered pair, then cancel opposing pairs against each other.
 *
 * Input may contain any number of duplicate or opposing entries.
 * Output has no zero-value edges and no pair pointing both ways.
 */
export function netPairs(debts: Debt[]): Debt[] {
  const totals = new Map<string, number>()

  for (const d of debts) {
    if (d.amountLuna <= 0) continue
    if (d.from === d.to) continue
    const key = edgeKey(d.from, d.to)
    totals.set(key, (totals.get(key) ?? 0) + d.amountLuna)
  }

  const out: Debt[] = []
  const consumed = new Set<string>()

  for (const [key, amount] of totals) {
    if (consumed.has(key)) continue
    const [from, to] = key.split('|')
    const reverseKey = edgeKey(to, from)
    const reverse = totals.get(reverseKey) ?? 0
    consumed.add(key)
    consumed.add(reverseKey)

    const net = amount - reverse
    if (net > 0) out.push({ from, to, amountLuna: net })
    else if (net < 0) out.push({ from: to, to: from, amountLuna: -net })
    // net === 0: the pair is square, nothing survives
  }

  return out
}

interface Graph {
  /** from -> to -> amount, all amounts > 0 */
  edges: Map<string, Map<string, number>>
}

function buildGraph(debts: Debt[]): Graph {
  const edges = new Map<string, Map<string, number>>()
  for (const d of debts) {
    if (d.amountLuna <= 0 || d.from === d.to) continue
    let row = edges.get(d.from)
    if (!row) {
      row = new Map()
      edges.set(d.from, row)
    }
    row.set(d.to, (row.get(d.to) ?? 0) + d.amountLuna)
  }
  return { edges }
}

function graphToDebts(graph: Graph): Debt[] {
  const out: Debt[] = []
  for (const [from, row] of graph.edges) {
    for (const [to, amountLuna] of row) {
      if (amountLuna > 0) out.push({ from, to, amountLuna })
    }
  }
  return out
}

/**
 * Find one directed cycle, if the graph has any.
 *
 * Iterative DFS with an explicit stack so a pathological group (someone will
 * try) cannot blow the call stack. Returns the cycle as an ordered list of
 * nodes where node[i] owes node[i+1] and the last owes the first.
 */
function findCycle(graph: Graph): string[] | null {
  const WHITE = 0
  const GREY = 1
  const BLACK = 2
  const colour = new Map<string, number>()
  for (const node of graph.edges.keys()) colour.set(node, WHITE)

  for (const root of graph.edges.keys()) {
    if (colour.get(root) !== WHITE) continue

    const path: string[] = []
    const iterators: Array<Iterator<string>> = []

    colour.set(root, GREY)
    path.push(root)
    iterators.push((graph.edges.get(root) ?? new Map()).keys())

    while (path.length > 0) {
      const node = path[path.length - 1]
      const it = iterators[iterators.length - 1]
      const step = it.next()

      if (step.done) {
        colour.set(node, BLACK)
        path.pop()
        iterators.pop()
        continue
      }

      const next = step.value
      const amount = graph.edges.get(node)?.get(next) ?? 0
      if (amount <= 0) continue

      const nextColour = colour.get(next) ?? WHITE
      if (nextColour === GREY) {
        // Found it. Slice the path from where `next` sits to the end.
        const start = path.indexOf(next)
        return path.slice(start)
      }
      if (nextColour === BLACK) continue

      colour.set(next, GREY)
      path.push(next)
      iterators.push((graph.edges.get(next) ?? new Map()).keys())
    }
  }

  return null
}

/**
 * Repeatedly find a debt cycle and delete the smallest edge in it from every
 * edge in that cycle.
 *
 * Each pass zeroes at least one edge, so this terminates in at most E passes.
 */
export function cancelCycles(debts: Debt[]): { residual: Debt[]; cycles: CancelledCycle[] } {
  const graph = buildGraph(debts)
  const cycles: CancelledCycle[] = []

  // Hard ceiling: one pass per edge, plus slack. Defensive, never reached in practice.
  const maxPasses = debts.length * 2 + 16

  for (let pass = 0; pass < maxPasses; pass++) {
    const cycle = findCycle(graph)
    if (!cycle) break

    // Smallest edge around the ring is how much we can cancel.
    let min = Infinity
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i]
      const to = cycle[(i + 1) % cycle.length]
      const amount = graph.edges.get(from)?.get(to) ?? 0
      if (amount < min) min = amount
    }
    if (!Number.isFinite(min) || min <= 0) break

    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i]
      const to = cycle[(i + 1) % cycle.length]
      const row = graph.edges.get(from)!
      const left = (row.get(to) ?? 0) - min
      if (left > 0) row.set(to, left)
      else row.delete(to)
    }

    cycles.push({ members: cycle.slice(), amountLuna: min })
  }

  return { residual: graphToDebts(graph), cycles }
}

/**
 * Everyone's net position: positive means they owe the group, negative means
 * the group owes them. Zero means they can stop reading.
 */
export function netPositions(debts: Debt[]): Map<string, number> {
  const pos = new Map<string, number>()
  const bump = (who: string, by: number) => pos.set(who, (pos.get(who) ?? 0) + by)
  for (const d of debts) {
    if (d.amountLuna <= 0 || d.from === d.to) continue
    bump(d.from, d.amountLuna)
    bump(d.to, -d.amountLuna)
  }
  for (const [k, v] of [...pos]) if (v === 0) pos.delete(k)
  return pos
}

/**
 * Rebalance a single tab down to the fewest transfers that leave every net
 * position untouched. Greedy: the deepest debtor pays the biggest creditor,
 * repeat. Produces at most (members - 1) transfers.
 *
 * This DOES reroute — B may end up paying A for something C ate — which is
 * why it is only ever run inside one tab, where everyone already agreed to
 * share a ledger.
 */
export function rebalanceWithinTab(raw: Debt[]): Debt[] {
  const positions = netPositions(raw)

  const debtors = [...positions.entries()]
    .filter(([, v]) => v > 0)
    .map(([who, amount]) => ({ who, amount }))
  const creditors = [...positions.entries()]
    .filter(([, v]) => v < 0)
    .map(([who, amount]) => ({ who, amount: -amount }))

  // Deterministic order — same input, same plan, every time.
  debtors.sort((a, b) => b.amount - a.amount || a.who.localeCompare(b.who))
  creditors.sort((a, b) => b.amount - a.amount || a.who.localeCompare(b.who))

  const out: Debt[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount)
    if (pay > 0) out.push({ from: debtors[i].who, to: creditors[j].who, amountLuna: pay })
    debtors[i].amount -= pay
    creditors[j].amount -= pay
    if (debtors[i].amount === 0) i++
    if (creditors[j].amount === 0) j++
  }
  return out
}

/**
 * Full pipeline.
 *
 * `tabs` is one entry per tab, holding that tab's raw obligations. Each tab
 * is rebalanced on its own, then the resulting transfers are pooled and any
 * cycle that runs across tabs is cancelled outright.
 *
 * `rawPaymentCount` is what the group would be doing without Loop: one
 * transfer per obligation, everybody settling every bill individually.
 */
export function buildSettlementPlan(
  tabs: Array<{ tabId: string; debts: Debt[]; rawDebts?: Debt[] }>,
): SettlementPlan {
  let rawPaymentCount = 0
  const pooled: Debt[] = []

  for (const tab of tabs) {
    const raw = tab.rawDebts ?? tab.debts
    rawPaymentCount += raw.filter((d) => d.amountLuna > 0 && d.from !== d.to).length
    pooled.push(...rebalanceWithinTab(tab.debts))
  }

  const netted = netPairs(pooled)
  const { residual, cycles } = cancelCycles(netted)

  let cancelledLuna = 0
  for (const c of cycles) cancelledLuna += c.amountLuna * c.members.length

  residual.sort((a, b) => b.amountLuna - a.amountLuna || a.from.localeCompare(b.from))

  return {
    debts: residual,
    cancelledCycles: cycles,
    rawPaymentCount,
    cancelledLuna,
  }
}

/**
 * Split `totalLuna` between `n` participants so the parts sum EXACTLY to the
 * total. The remainder is handed out one luna at a time to the first parts,
 * which is the only split where nobody can find a missing luna later.
 */
export function splitEqually(totalLuna: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(totalLuna / n)
  let remainder = totalLuna - base * n
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(base + (remainder > 0 ? 1 : 0))
    if (remainder > 0) remainder--
  }
  return out
}

/**
 * Split `totalLuna` in proportion to `weights`, again summing exactly.
 * Largest-remainder method, so the rounding goes where it is least noticed.
 */
export function splitByShares(totalLuna: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  if (totalWeight <= 0) return splitEqually(totalLuna, weights.length)

  const exact = weights.map((w) => (totalLuna * w) / totalWeight)
  const floors = exact.map((v) => Math.floor(v))
  let remainder = totalLuna - floors.reduce((a, b) => a + b, 0)

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)

  const out = floors.slice()
  for (const { i } of order) {
    if (remainder <= 0) break
    out[i]++
    remainder--
  }
  return out
}

/**
 * Turn one expense into the obligations it creates.
 *
 * The payer fronted the whole thing, so everyone else owes the payer their
 * share. The payer's own share creates nothing — they already paid it.
 */
export function expenseToDebts(
  payer: string,
  shares: Array<{ address: string; shareLuna: number }>,
): Debt[] {
  const out: Debt[] = []
  for (const s of shares) {
    if (s.address === payer) continue
    if (s.shareLuna <= 0) continue
    out.push({ from: s.address, to: payer, amountLuna: s.shareLuna })
  }
  return out
}

/**
 * Spread a cancelled or settled amount back over the individual tabs the debt
 * came from, biggest tab first, so every tab's own balance stays true.
 */
export function allocateAcrossTabs(
  perTab: Array<{ tabId: string; amountLuna: number }>,
  amountLuna: number,
): Array<{ tabId: string; amountLuna: number }> {
  const sorted = perTab
    .filter((t) => t.amountLuna > 0)
    .sort((a, b) => b.amountLuna - a.amountLuna || a.tabId.localeCompare(b.tabId))

  const out: Array<{ tabId: string; amountLuna: number }> = []
  let left = amountLuna
  for (const t of sorted) {
    if (left <= 0) break
    const take = Math.min(left, t.amountLuna)
    out.push({ tabId: t.tabId, amountLuna: take })
    left -= take
  }
  return out
}
