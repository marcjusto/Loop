import { describe, expect, it } from 'vitest'
import {
  allocateAcrossTabs,
  buildSettlementPlan,
  cancelCycles,
  expenseToDebts,
  netPairs,
  netPositions,
  rebalanceWithinTab,
  splitByShares,
  splitEqually,
} from '../shared/netting.js'
import type { Debt } from '../shared/types.js'

/**
 * Every person's net position — what they owe minus what they are owed — is
 * the only thing that must survive netting. If this number moves, somebody
 * lost money. Every test below leans on it.
 */

function expectSamePositions(before: Debt[], after: Debt[]) {
  const a = netPositions(before)
  const b = netPositions(after)
  expect([...b.keys()].sort()).toEqual([...a.keys()].sort())
  for (const [k, v] of a) expect(b.get(k)).toBe(v)
}

/** Deterministic PRNG so a failure is reproducible from the seed alone. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomDebts(rand: () => number, people: number, count: number): Debt[] {
  const names = Array.from({ length: people }, (_, i) => `NQ${i}`)
  const out: Debt[] = []
  for (let i = 0; i < count; i++) {
    const a = names[Math.floor(rand() * people)]
    let b = names[Math.floor(rand() * people)]
    if (a === b) b = names[(names.indexOf(a) + 1) % people]
    out.push({ from: a, to: b, amountLuna: 1 + Math.floor(rand() * 500_000) })
  }
  return out
}

describe('netPairs', () => {
  it('collapses repeated debts in the same direction', () => {
    const out = netPairs([
      { from: 'A', to: 'B', amountLuna: 100 },
      { from: 'A', to: 'B', amountLuna: 250 },
    ])
    expect(out).toEqual([{ from: 'A', to: 'B', amountLuna: 350 }])
  })

  it('cancels opposing debts down to the difference', () => {
    const out = netPairs([
      { from: 'A', to: 'B', amountLuna: 500 },
      { from: 'B', to: 'A', amountLuna: 300 },
    ])
    expect(out).toEqual([{ from: 'A', to: 'B', amountLuna: 200 }])
  })

  it('erases a pair that is exactly square', () => {
    const out = netPairs([
      { from: 'A', to: 'B', amountLuna: 400 },
      { from: 'B', to: 'A', amountLuna: 400 },
    ])
    expect(out).toEqual([])
  })

  it('drops self-debt and non-positive amounts', () => {
    const out = netPairs([
      { from: 'A', to: 'A', amountLuna: 900 },
      { from: 'A', to: 'B', amountLuna: 0 },
      { from: 'A', to: 'B', amountLuna: -50 },
    ])
    expect(out).toEqual([])
  })

  it('preserves every net position', () => {
    const rand = mulberry32(7)
    for (let trial = 0; trial < 200; trial++) {
      const raw = randomDebts(rand, 2 + Math.floor(rand() * 8), 1 + Math.floor(rand() * 40))
      expectSamePositions(raw, netPairs(raw))
    }
  })
})

describe('cancelCycles', () => {
  it('erases a perfect three-way ring entirely', () => {
    const { residual, cycles } = cancelCycles([
      { from: 'A', to: 'B', amountLuna: 1000 },
      { from: 'B', to: 'C', amountLuna: 1000 },
      { from: 'C', to: 'A', amountLuna: 1000 },
    ])
    expect(residual).toEqual([])
    expect(cycles).toHaveLength(1)
    expect(cycles[0].amountLuna).toBe(1000)
    expect(cycles[0].members.sort()).toEqual(['A', 'B', 'C'])
  })

  it('cancels only the smallest edge of an uneven ring', () => {
    const { residual, cycles } = cancelCycles([
      { from: 'A', to: 'B', amountLuna: 1000 },
      { from: 'B', to: 'C', amountLuna: 400 },
      { from: 'C', to: 'A', amountLuna: 700 },
    ])
    expect(cycles[0].amountLuna).toBe(400)
    const map = new Map(residual.map((d) => [`${d.from}->${d.to}`, d.amountLuna]))
    expect(map.get('A->B')).toBe(600)
    expect(map.get('C->A')).toBe(300)
    expect(map.has('B->C')).toBe(false)
  })

  it('leaves an acyclic chain completely alone', () => {
    const input: Debt[] = [
      { from: 'A', to: 'B', amountLuna: 500 },
      { from: 'B', to: 'C', amountLuna: 300 },
    ]
    const { residual, cycles } = cancelCycles(input)
    expect(cycles).toEqual([])
    expect(residual).toHaveLength(2)
  })

  it('never invents a debt between two people who had none', () => {
    const rand = mulberry32(99)
    for (let trial = 0; trial < 300; trial++) {
      const raw = netPairs(randomDebts(rand, 3 + Math.floor(rand() * 7), 5 + Math.floor(rand() * 30)))
      const existing = new Set(raw.map((d) => `${d.from}->${d.to}`))
      const { residual } = cancelCycles(raw)
      for (const d of residual) {
        expect(existing.has(`${d.from}->${d.to}`)).toBe(true)
      }
    }
  })

  it('never increases any single debt', () => {
    const rand = mulberry32(1234)
    for (let trial = 0; trial < 300; trial++) {
      const raw = netPairs(randomDebts(rand, 3 + Math.floor(rand() * 7), 5 + Math.floor(rand() * 30)))
      const before = new Map(raw.map((d) => [`${d.from}->${d.to}`, d.amountLuna]))
      const { residual } = cancelCycles(raw)
      for (const d of residual) {
        expect(d.amountLuna).toBeLessThanOrEqual(before.get(`${d.from}->${d.to}`)!)
      }
    }
  })

  it('preserves every net position and leaves no cycle behind', () => {
    const rand = mulberry32(2024)
    for (let trial = 0; trial < 300; trial++) {
      const raw = netPairs(randomDebts(rand, 3 + Math.floor(rand() * 8), 5 + Math.floor(rand() * 40)))
      const { residual } = cancelCycles(raw)
      expectSamePositions(raw, residual)
      // A second pass must find nothing left to cancel.
      expect(cancelCycles(residual).cycles).toEqual([])
    }
  })

  it('handles a long ring without blowing the stack', () => {
    const n = 5000
    const raw: Debt[] = []
    for (let i = 0; i < n; i++) {
      raw.push({ from: `P${i}`, to: `P${(i + 1) % n}`, amountLuna: 100 })
    }
    const { residual, cycles } = cancelCycles(raw)
    expect(residual).toEqual([])
    expect(cycles).toHaveLength(1)
    expect(cycles[0].members).toHaveLength(n)
  })
})

describe('rebalanceWithinTab', () => {
  it('collapses a three-way weekend into a single payment', () => {
    const raw: Debt[] = [
      ...expenseToDebts('A', [
        { address: 'A', shareLuna: 1000 },
        { address: 'B', shareLuna: 1000 },
        { address: 'C', shareLuna: 1000 },
      ]),
      ...expenseToDebts('B', [
        { address: 'A', shareLuna: 800 },
        { address: 'B', shareLuna: 800 },
        { address: 'C', shareLuna: 800 },
      ]),
      ...expenseToDebts('C', [
        { address: 'A', shareLuna: 900 },
        { address: 'B', shareLuna: 900 },
        { address: 'C', shareLuna: 900 },
      ]),
    ]
    const out = rebalanceWithinTab(raw)
    expect(out).toEqual([{ from: 'B', to: 'A', amountLuna: 300 }])
    expectSamePositions(raw, out)
  })

  it('never needs more than (people - 1) transfers', () => {
    const rand = mulberry32(555)
    for (let trial = 0; trial < 500; trial++) {
      const people = 2 + Math.floor(rand() * 9)
      const raw = randomDebts(rand, people, 3 + Math.floor(rand() * 40))
      const out = rebalanceWithinTab(raw)
      const involved = new Set<string>()
      for (const d of raw) {
        involved.add(d.from)
        involved.add(d.to)
      }
      expect(out.length).toBeLessThanOrEqual(Math.max(0, involved.size - 1))
      expectSamePositions(raw, out)
    }
  })

  it('returns nothing when the tab is already square', () => {
    expect(
      rebalanceWithinTab([
        { from: 'A', to: 'B', amountLuna: 500 },
        { from: 'B', to: 'A', amountLuna: 500 },
      ]),
    ).toEqual([])
  })

  it('is deterministic', () => {
    const rand = mulberry32(808)
    const raw = randomDebts(rand, 6, 25)
    expect(rebalanceWithinTab(raw)).toEqual(rebalanceWithinTab(raw))
  })
})

describe('buildSettlementPlan', () => {
  it('turns a messy weekend into one payment', () => {
    const raw: Debt[] = [
      ...expenseToDebts('A', [
        { address: 'A', shareLuna: 1000 },
        { address: 'B', shareLuna: 1000 },
        { address: 'C', shareLuna: 1000 },
      ]),
      ...expenseToDebts('B', [
        { address: 'A', shareLuna: 800 },
        { address: 'B', shareLuna: 800 },
        { address: 'C', shareLuna: 800 },
      ]),
      ...expenseToDebts('C', [
        { address: 'A', shareLuna: 900 },
        { address: 'B', shareLuna: 900 },
        { address: 'C', shareLuna: 900 },
      ]),
    ]
    const plan = buildSettlementPlan([{ tabId: 't1', debts: raw }])
    expect(plan.rawPaymentCount).toBe(6)
    expect(plan.debts).toEqual([{ from: 'B', to: 'A', amountLuna: 300 }])
    expectSamePositions(raw, plan.debts)
  })

  it('cancels a ring that only exists across three separate tabs', () => {
    // Nobody sees the ring from inside their own tab. Loop sees all three.
    const plan = buildSettlementPlan([
      { tabId: 'flat', debts: [{ from: 'A', to: 'B', amountLuna: 2500 }] },
      { tabId: 'ski', debts: [{ from: 'B', to: 'C', amountLuna: 2500 }] },
      { tabId: 'lunch', debts: [{ from: 'C', to: 'A', amountLuna: 2500 }] },
    ])
    expect(plan.debts).toEqual([])
    expect(plan.cancelledLuna).toBe(7500)
    expect(plan.rawPaymentCount).toBe(3)
    expect(plan.cancelledCycles).toHaveLength(1)
  })

  it('keeps every net position intact across many random tabs', () => {
    const rand = mulberry32(60606)
    for (let trial = 0; trial < 200; trial++) {
      const tabCount = 1 + Math.floor(rand() * 4)
      const tabs = Array.from({ length: tabCount }, (_, i) => ({
        tabId: `t${i}`,
        debts: randomDebts(rand, 2 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 20)),
      }))
      const everything = tabs.flatMap((t) => t.debts)
      const plan = buildSettlementPlan(tabs)
      expectSamePositions(everything, plan.debts)
      expect(plan.debts.length).toBeLessThanOrEqual(plan.rawPaymentCount)
    }
  })
})

describe('splitEqually', () => {
  it('sums to exactly the total, always', () => {
    const rand = mulberry32(31337)
    for (let trial = 0; trial < 2000; trial++) {
      const total = Math.floor(rand() * 10_000_000)
      const n = 1 + Math.floor(rand() * 12)
      const parts = splitEqually(total, n)
      expect(parts).toHaveLength(n)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
    }
  })

  it('hands the odd luna to the front of the list', () => {
    expect(splitEqually(10, 3)).toEqual([4, 3, 3])
  })

  it('survives an empty group', () => {
    expect(splitEqually(100, 0)).toEqual([])
  })
})

describe('splitByShares', () => {
  it('sums to exactly the total, always', () => {
    const rand = mulberry32(4242)
    for (let trial = 0; trial < 2000; trial++) {
      const total = Math.floor(rand() * 10_000_000)
      const n = 1 + Math.floor(rand() * 8)
      const weights = Array.from({ length: n }, () => 1 + Math.floor(rand() * 10))
      const parts = splitByShares(total, weights)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
    }
  })

  it('respects the weights', () => {
    expect(splitByShares(300, [1, 2])).toEqual([100, 200])
  })

  it('falls back to an even split when all weights are zero', () => {
    expect(splitByShares(9, [0, 0, 0])).toEqual([3, 3, 3])
  })
})

describe('allocateAcrossTabs', () => {
  it('drains the biggest tab first and stops when satisfied', () => {
    const out = allocateAcrossTabs(
      [
        { tabId: 'small', amountLuna: 100 },
        { tabId: 'big', amountLuna: 900 },
      ],
      500,
    )
    expect(out).toEqual([{ tabId: 'big', amountLuna: 500 }])
  })

  it('spills into the next tab when the first is not enough', () => {
    const out = allocateAcrossTabs(
      [
        { tabId: 'big', amountLuna: 400 },
        { tabId: 'small', amountLuna: 300 },
      ],
      600,
    )
    expect(out).toEqual([
      { tabId: 'big', amountLuna: 400 },
      { tabId: 'small', amountLuna: 200 },
    ])
  })

  it('never allocates more than a tab actually holds', () => {
    const out = allocateAcrossTabs([{ tabId: 'only', amountLuna: 50 }], 9999)
    expect(out).toEqual([{ tabId: 'only', amountLuna: 50 }])
  })
})
