/**
 * Loop — the API.
 *
 * One Worker serves both the built Vue app and `/api/*`, so there is a single
 * origin and no CORS configuration to get wrong.
 */

import { Hono } from 'hono'
import { createChallenge, login, requireUser, type AuthedUser } from './auth.js'
import { allocateSettlement, globalCycles, planForUser, ringKey, tabDebts } from './ledger.js'
import { ApiError, cleanText, newId, newInviteCode, now, parseLuna, type Env } from './util.js'
import { splitByShares, splitEqually } from '../shared/netting.js'
import { isValidAddress, normalizeAddress } from '../shared/nimiq-address.js'
import { LUNA_PER_NIM } from '../shared/types.js'

type Vars = { user: AuthedUser }

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

// ── Error shape ────────────────────────────────────────────────────────────
// Every failure comes back as { error, code } with a sentence a person can
// read. The UI shows it verbatim, so it must never be a stack trace.

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message, code: err.code ?? 'error' }, err.status as 400)
  }
  console.error('Unhandled error:', err)
  return c.json({ error: 'Something broke on our side. Try again in a moment.', code: 'internal' }, 500)
})

app.use('/api/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})

// ── Auth ───────────────────────────────────────────────────────────────────

app.post('/api/auth/challenge', async (c) => {
  return c.json(await createChallenge(c.env))
})

app.post('/api/auth/login', async (c) => {
  const body = await readJson(c.req.raw)
  const nonce = typeof body.nonce === 'string' ? body.nonce : ''
  const publicKey = typeof body.publicKey === 'string' ? body.publicKey : ''
  const signature = typeof body.signature === 'string' ? body.signature : ''
  if (!nonce || !publicKey || !signature) {
    throw new ApiError(400, 'Sign-in is missing something. Try again.', 'bad_request')
  }
  const result = await login(
    c.env,
    nonce,
    publicKey,
    signature,
    typeof body.address === 'string' ? body.address : undefined,
    typeof body.displayName === 'string' ? body.displayName : undefined,
  )
  return c.json(result)
})

// Everything past this point needs a session.
const authed = new Hono<{ Bindings: Env; Variables: Vars }>()
authed.use('*', async (c, next) => {
  c.set('user', await requireUser(c.env, c.req.raw))
  await next()
})

// ── Me ─────────────────────────────────────────────────────────────────────

authed.get('/me', async (c) => {
  const user = c.get('user')
  const plan = await planForUser(c.env, user.address)
  const members = [
    ...(await memberDirectory(c.env, [
      ...plan.debts.flatMap((d) => [d.from, d.to]),
      ...plan.cancelledCycles.flatMap((r) => r.members),
    ])),
    ...plan.maskedMembers,
  ]
  return c.json({ user, plan, members })
})

authed.patch('/me', async (c) => {
  const user = c.get('user')
  const body = await readJson(c.req.raw)
  const displayName = cleanText(body.displayName, 40)
  if (displayName.length < 1) throw new ApiError(400, 'Pick a name with at least one character.', 'bad_name')
  await c.env.DB.prepare('UPDATE users SET display_name = ? WHERE address = ?')
    .bind(displayName, user.address)
    .run()
  return c.json({ ok: true, displayName })
})

// ── Tabs ───────────────────────────────────────────────────────────────────

authed.get('/tabs', async (c) => {
  const user = c.get('user')
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.emoji, t.invite_code, t.created_by, t.created_at, t.archived,
            (SELECT COUNT(*) FROM tab_members m WHERE m.tab_id = t.id)     AS member_count,
            (SELECT COUNT(*) FROM expenses e WHERE e.tab_id = t.id AND e.voided = 0) AS expense_count,
            (SELECT MAX(e.created_at) FROM expenses e WHERE e.tab_id = t.id AND e.voided = 0) AS last_activity
       FROM tabs t
       JOIN tab_members tm ON tm.tab_id = t.id
      WHERE tm.address = ?
      ORDER BY COALESCE(last_activity, t.created_at) DESC`,
  )
    .bind(user.address)
    .all<any>()

  const tabs = []
  for (const row of results ?? []) {
    const debts = await tabDebts(c.env, row.id)
    let net = 0
    for (const d of debts) {
      if (d.from === user.address) net -= d.amountLuna
      if (d.to === user.address) net += d.amountLuna
    }
    tabs.push({
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      inviteCode: row.invite_code,
      createdBy: row.created_by,
      createdAt: row.created_at,
      archived: !!row.archived,
      memberCount: row.member_count,
      expenseCount: row.expense_count,
      lastActivity: row.last_activity ?? row.created_at,
      /** Positive: the tab owes you. Negative: you owe the tab. */
      yourNetLuna: net,
    })
  }
  return c.json({ tabs })
})

authed.post('/tabs', async (c) => {
  const user = c.get('user')
  const body = await readJson(c.req.raw)
  const name = cleanText(body.name, 60)
  if (name.length < 1) throw new ApiError(400, 'Give the tab a name.', 'bad_name')
  const emoji = cleanText(body.emoji, 8) || '🧾'

  const id = newId()
  const code = await uniqueInviteCode(c.env)
  const ts = now()

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO tabs (id, name, emoji, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, name, emoji, code, user.address, ts),
    c.env.DB.prepare('INSERT INTO tab_members (tab_id, address, joined_at) VALUES (?, ?, ?)').bind(
      id,
      user.address,
      ts,
    ),
  ])

  return c.json({ id, name, emoji, inviteCode: code })
})

authed.post('/tabs/join', async (c) => {
  const user = c.get('user')
  const body = await readJson(c.req.raw)
  const code = cleanText(body.inviteCode, 16).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!code) throw new ApiError(400, 'Enter an invite code.', 'bad_code')

  const tab = await c.env.DB.prepare('SELECT id, name, emoji FROM tabs WHERE invite_code = ?')
    .bind(code)
    .first<{ id: string; name: string; emoji: string }>()
  if (!tab) throw new ApiError(404, 'No tab with that code. Check the letters and try again.', 'no_tab')

  const already = await c.env.DB.prepare('SELECT 1 FROM tab_members WHERE tab_id = ? AND address = ?')
    .bind(tab.id, user.address)
    .first()

  if (!already) {
    await c.env.DB.prepare('INSERT INTO tab_members (tab_id, address, joined_at) VALUES (?, ?, ?)')
      .bind(tab.id, user.address, now())
      .run()
  }

  return c.json({ id: tab.id, name: tab.name, emoji: tab.emoji, alreadyMember: !!already })
})

authed.get('/tabs/:id', async (c) => {
  const user = c.get('user')
  const tabId = c.req.param('id')
  await requireMembership(c.env, tabId, user.address)

  const tab = await c.env.DB.prepare(
    'SELECT id, name, emoji, invite_code, created_by, created_at, archived FROM tabs WHERE id = ?',
  )
    .bind(tabId)
    .first<any>()
  if (!tab) throw new ApiError(404, 'That tab no longer exists.', 'no_tab')

  const { results: memberRows } = await c.env.DB.prepare(
    `SELECT u.address, u.display_name, u.avatar_seed, m.joined_at
       FROM tab_members m JOIN users u ON u.address = m.address
      WHERE m.tab_id = ? ORDER BY m.joined_at ASC`,
  )
    .bind(tabId)
    .all<any>()

  const { results: expenseRows } = await c.env.DB.prepare(
    `SELECT id, payer, amount_luna, description, category, fiat_currency, fiat_amount, fiat_rate,
            created_by, created_at
       FROM expenses WHERE tab_id = ? AND voided = 0 ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(tabId)
    .all<any>()

  const { results: shareRows } = await c.env.DB.prepare(
    `SELECT s.expense_id, s.address, s.share_luna
       FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
      WHERE e.tab_id = ? AND e.voided = 0`,
  )
    .bind(tabId)
    .all<any>()

  const sharesByExpense = new Map<string, Array<{ address: string; shareLuna: number }>>()
  for (const row of shareRows ?? []) {
    const list = sharesByExpense.get(row.expense_id) ?? []
    list.push({ address: row.address, shareLuna: row.share_luna })
    sharesByExpense.set(row.expense_id, list)
  }

  const { results: settlementRows } = await c.env.DB.prepare(
    `SELECT id, from_addr, to_addr, amount_luna, tx_hash, block_height, status, created_at
       FROM transfers WHERE tab_id = ? AND status = 'confirmed'
      ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(tabId)
    .all<any>()

  const debts = await tabDebts(c.env, tabId)

  let totalSpent = 0
  for (const e of expenseRows ?? []) totalSpent += e.amount_luna

  return c.json({
    tab: {
      id: tab.id,
      name: tab.name,
      emoji: tab.emoji,
      inviteCode: tab.invite_code,
      createdBy: tab.created_by,
      createdAt: tab.created_at,
      archived: !!tab.archived,
    },
    members: (memberRows ?? []).map((m) => ({
      address: m.address,
      displayName: m.display_name,
      avatarSeed: m.avatar_seed,
    })),
    expenses: (expenseRows ?? []).map((e) => ({
      id: e.id,
      payer: e.payer,
      amountLuna: e.amount_luna,
      description: e.description,
      category: e.category,
      fiatCurrency: e.fiat_currency,
      fiatAmount: e.fiat_amount,
      fiatRate: e.fiat_rate,
      createdBy: e.created_by,
      createdAt: e.created_at,
      shares: sharesByExpense.get(e.id) ?? [],
    })),
    settlements: (settlementRows ?? []).map((s) => ({
      id: s.id,
      fromAddr: s.from_addr,
      toAddr: s.to_addr,
      amountLuna: s.amount_luna,
      txHash: s.tx_hash,
      blockHeight: s.block_height,
      status: s.status,
      createdAt: s.created_at,
    })),
    debts,
    totalSpentLuna: totalSpent,
  })
})

authed.post('/tabs/:id/expenses', async (c) => {
  const user = c.get('user')
  const tabId = c.req.param('id')
  await requireMembership(c.env, tabId, user.address)

  const body = await readJson(c.req.raw)
  const amountLuna = parseLuna(body.amountLuna)
  if (amountLuna === null) {
    throw new ApiError(400, 'Enter an amount greater than zero.', 'bad_amount')
  }
  const description = cleanText(body.description, 120) || 'Expense'
  const category = cleanText(body.category, 24) || 'general'

  const members = await tabMemberAddresses(c.env, tabId)
  const payer = normalizeOrThrow(body.payer ?? user.address)
  if (!members.includes(payer)) {
    throw new ApiError(400, 'That payer is not in this tab.', 'bad_payer')
  }

  const shares = resolveShares(body, members, amountLuna)

  const expenseId = newId()
  const ts = now()
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO expenses (id, tab_id, payer, amount_luna, description, category,
                             fiat_currency, fiat_amount, fiat_rate, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      expenseId,
      tabId,
      payer,
      amountLuna,
      description,
      category,
      typeof body.fiatCurrency === 'string' ? body.fiatCurrency.slice(0, 8) : null,
      typeof body.fiatAmount === 'number' && Number.isFinite(body.fiatAmount) ? body.fiatAmount : null,
      typeof body.fiatRate === 'number' && Number.isFinite(body.fiatRate) ? body.fiatRate : null,
      user.address,
      ts,
    ),
    ...shares.map((s) =>
      c.env.DB.prepare(
        'INSERT INTO expense_shares (expense_id, address, share_luna) VALUES (?, ?, ?)',
      ).bind(expenseId, s.address, s.shareLuna),
    ),
  ]
  await c.env.DB.batch(statements)

  return c.json({ id: expenseId, shares })
})

authed.delete('/tabs/:id/expenses/:expenseId', async (c) => {
  const user = c.get('user')
  const tabId = c.req.param('id')
  const expenseId = c.req.param('expenseId')
  await requireMembership(c.env, tabId, user.address)

  const expense = await c.env.DB.prepare('SELECT id, created_by, payer FROM expenses WHERE id = ? AND tab_id = ?')
    .bind(expenseId, tabId)
    .first<{ id: string; created_by: string; payer: string }>()
  if (!expense) throw new ApiError(404, 'That expense is already gone.', 'no_expense')

  // Anyone in the tab can remove a mistake. The tab sees everything anyway, and
  // locking it to the author just means bad numbers stick around.
  await c.env.DB.prepare('UPDATE expenses SET voided = 1 WHERE id = ?').bind(expenseId).run()
  return c.json({ ok: true })
})

authed.post('/tabs/:id/leave', async (c) => {
  const user = c.get('user')
  const tabId = c.req.param('id')
  await requireMembership(c.env, tabId, user.address)

  const debts = await tabDebts(c.env, tabId)
  const open = debts.some((d) => d.from === user.address || d.to === user.address)
  if (open) {
    throw new ApiError(400, 'Settle up in this tab before you leave it.', 'open_balance')
  }

  await c.env.DB.prepare('DELETE FROM tab_members WHERE tab_id = ? AND address = ?')
    .bind(tabId, user.address)
    .run()
  return c.json({ ok: true })
})

// ── Settling ───────────────────────────────────────────────────────────────

authed.get('/settle', async (c) => {
  const user = c.get('user')
  const plan = await planForUser(c.env, user.address)

  // Log any ring we have not seen before, so the feed and the global counter
  // have something to show. Logged from the unmasked view so the same ring
  // spotted by two different people is recorded once, not twice.
  for (const cycle of await globalCycles(c.env, user.address)) {
    const key = ringKey(cycle)
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO loop_runs (id, ring_key, amount_luna, members, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(newId(), key, cycle.amountLuna, JSON.stringify(cycle.members), now())
      .run()
  }

  const members = [
    ...(await memberDirectory(c.env, [
      ...plan.debts.flatMap((d) => [d.from, d.to]),
      ...plan.cancelledCycles.flatMap((r) => r.members),
    ])),
    ...plan.maskedMembers,
  ]

  const { results: pending } = await c.env.DB.prepare(
    `SELECT id, to_addr, amount_luna, created_at FROM transfers
      WHERE from_addr = ? AND status = 'pending' AND created_at > ?`,
  )
    .bind(user.address, now() - 15 * 60 * 1000)
    .all<any>()

  return c.json({
    plan,
    members,
    pending: (pending ?? []).map((p) => ({
      id: p.id,
      toAddr: p.to_addr,
      amountLuna: p.amount_luna,
      createdAt: p.created_at,
    })),
  })
})

/**
 * Step one of paying somebody: we write down what is about to happen and hand
 * back a memo to attach to the transaction. If the user backs out of the
 * native dialog, nothing here has touched a balance.
 */
authed.post('/settle/prepare', async (c) => {
  const user = c.get('user')
  const body = await readJson(c.req.raw)
  const to = normalizeOrThrow(body.toAddr)
  const amountLuna = parseLuna(body.amountLuna)
  if (amountLuna === null) throw new ApiError(400, 'That amount is not valid.', 'bad_amount')
  if (to === user.address) throw new ApiError(400, 'You cannot pay yourself.', 'self_pay')

  const plan = await planForUser(c.env, user.address)
  const owed = plan.youOwe.find((d) => d.to === to)
  if (!owed) throw new ApiError(400, 'You are square with them — nothing to pay.', 'nothing_owed')
  if (amountLuna > owed.amountLuna) {
    throw new ApiError(400, 'That is more than you owe them.', 'over_payment')
  }

  const batchId = newId()
  const allocations = await allocateSettlement(c.env, user.address, to, amountLuna)
  const ts = now()

  await c.env.DB.batch(
    allocations.map((a) =>
      c.env.DB.prepare(
        `INSERT INTO transfers (id, kind, from_addr, to_addr, amount_luna, tab_id, status, batch_id, created_at)
         VALUES (?, 'settlement', ?, ?, ?, ?, 'pending', ?, ?)`,
      ).bind(newId(), user.address, to, a.amountLuna, a.tabId, batchId, ts),
    ),
  )

  return c.json({
    batchId,
    recipient: to,
    amountLuna,
    // The Nimiq data field caps at 64 bytes, so keep the memo short and useful.
    memo: `Loop settle ${batchId.slice(0, 8)}`,
  })
})

authed.post('/settle/confirm', async (c) => {
  const user = c.get('user')
  const body = await readJson(c.req.raw)
  const batchId = typeof body.batchId === 'string' ? body.batchId : ''
  const txHash = cleanText(body.txHash, 128)
  const blockHeight =
    typeof body.blockHeight === 'number' && Number.isFinite(body.blockHeight)
      ? Math.floor(body.blockHeight)
      : null
  if (!batchId || !txHash) throw new ApiError(400, 'That payment is missing its receipt.', 'bad_request')

  const { meta } = await c.env.DB.prepare(
    `UPDATE transfers SET status = 'confirmed', tx_hash = ?, block_height = ?, confirmed_at = ?
      WHERE batch_id = ? AND from_addr = ? AND status = 'pending'`,
  )
    .bind(txHash, blockHeight, now(), batchId, user.address)
    .run()

  if (!meta.changes) {
    throw new ApiError(404, 'We could not find that payment to confirm.', 'no_batch')
  }
  return c.json({ ok: true, confirmed: meta.changes })
})

authed.post('/settle/cancel', async (c) => {
  const user = c.get('user')
  const body = await readJson(c.req.raw)
  const batchId = typeof body.batchId === 'string' ? body.batchId : ''
  if (!batchId) throw new ApiError(400, 'Missing payment reference.', 'bad_request')

  await c.env.DB.prepare(
    `UPDATE transfers SET status = ? WHERE batch_id = ? AND from_addr = ? AND status = 'pending'`,
  )
    .bind(body.failed ? 'failed' : 'cancelled', batchId, user.address)
    .run()
  return c.json({ ok: true })
})

// ── Activity and stats ─────────────────────────────────────────────────────

authed.get('/activity', async (c) => {
  const user = c.get('user')

  const { results: expenses } = await c.env.DB.prepare(
    `SELECT e.id, e.tab_id, t.name AS tab_name, t.emoji, e.payer, e.amount_luna, e.description, e.created_at
       FROM expenses e JOIN tabs t ON t.id = e.tab_id
      WHERE e.voided = 0 AND e.tab_id IN (SELECT tab_id FROM tab_members WHERE address = ?)
      ORDER BY e.created_at DESC LIMIT 40`,
  )
    .bind(user.address)
    .all<any>()

  const { results: settlements } = await c.env.DB.prepare(
    `SELECT id, from_addr, to_addr, amount_luna, tx_hash, block_height, created_at
       FROM transfers
      WHERE status = 'confirmed' AND (from_addr = ? OR to_addr = ?)
      ORDER BY created_at DESC LIMIT 40`,
  )
    .bind(user.address, user.address)
    .all<any>()

  const addresses = new Set<string>()
  for (const e of expenses ?? []) addresses.add(e.payer)
  for (const s of settlements ?? []) {
    addresses.add(s.from_addr)
    addresses.add(s.to_addr)
  }

  return c.json({
    expenses: (expenses ?? []).map((e) => ({
      id: e.id,
      tabId: e.tab_id,
      tabName: e.tab_name,
      emoji: e.emoji,
      payer: e.payer,
      amountLuna: e.amount_luna,
      description: e.description,
      createdAt: e.created_at,
    })),
    settlements: (settlements ?? []).map((s) => ({
      id: s.id,
      fromAddr: s.from_addr,
      toAddr: s.to_addr,
      amountLuna: s.amount_luna,
      txHash: s.tx_hash,
      blockHeight: s.block_height,
      createdAt: s.created_at,
    })),
    members: await memberDirectory(c.env, [...addresses]),
  })
})

// Public: the counter on the welcome screen. No session needed.
app.get('/api/stats', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM users)                                          AS users,
       (SELECT COUNT(*) FROM tabs)                                           AS tabs,
       (SELECT COUNT(*) FROM expenses WHERE voided = 0)                      AS expenses,
       (SELECT COALESCE(SUM(amount_luna), 0) FROM expenses WHERE voided = 0) AS tracked_luna,
       (SELECT COUNT(*) FROM transfers WHERE status = 'confirmed')           AS settlements,
       (SELECT COALESCE(SUM(amount_luna), 0) FROM transfers WHERE status = 'confirmed') AS settled_luna,
       (SELECT COUNT(*) FROM loop_runs)                                      AS rings,
       (SELECT COALESCE(SUM(amount_luna * (LENGTH(members) - LENGTH(REPLACE(members, ',', '')) + 1)), 0)
          FROM loop_runs)                                                    AS cancelled_luna`,
  ).first<any>()

  return c.json({
    users: row?.users ?? 0,
    tabs: row?.tabs ?? 0,
    expenses: row?.expenses ?? 0,
    trackedLuna: row?.tracked_luna ?? 0,
    settlements: row?.settlements ?? 0,
    settledLuna: row?.settled_luna ?? 0,
    rings: row?.rings ?? 0,
    cancelledLuna: row?.cancelled_luna ?? 0,
  })
})

// ── NIM price ──────────────────────────────────────────────────────────────
// Cached in D1 for ten minutes. If the upstream is down we serve the stale
// value and say so, rather than blocking somebody from logging a dinner.

app.get('/api/price', async (c) => {
  const currency = (c.req.query('currency') ?? 'usd').toLowerCase().slice(0, 5)
  if (!/^[a-z]{3,5}$/.test(currency)) {
    throw new ApiError(400, 'That currency code is not valid.', 'bad_currency')
  }

  const cached = await c.env.DB.prepare('SELECT rate, fetched_at FROM price_cache WHERE currency = ?')
    .bind(currency)
    .first<{ rate: number; fetched_at: number }>()

  const TEN_MINUTES = 10 * 60 * 1000
  if (cached && now() - cached.fetched_at < TEN_MINUTES) {
    return c.json({ currency, rate: cached.rate, fetchedAt: cached.fetched_at, stale: false })
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=${encodeURIComponent(currency)}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) },
    )
    if (!res.ok) throw new Error(`price upstream ${res.status}`)
    const data = (await res.json()) as Record<string, Record<string, number>>
    const rate = data['nimiq-2']?.[currency]
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new Error('price upstream returned nothing usable')
    }
    const ts = now()
    await c.env.DB.prepare(
      'INSERT INTO price_cache (currency, rate, fetched_at) VALUES (?, ?, ?) ON CONFLICT (currency) DO UPDATE SET rate = ?, fetched_at = ?',
    )
      .bind(currency, rate, ts, rate, ts)
      .run()
    return c.json({ currency, rate, fetchedAt: ts, stale: false })
  } catch (err) {
    if (cached) {
      return c.json({ currency, rate: cached.rate, fetchedAt: cached.fetched_at, stale: true })
    }
    // No rate at all. The app falls back to NIM-only entry, which still works.
    return c.json({ currency, rate: null, fetchedAt: null, stale: true }, 200)
  }
})

app.route('/api', authed)

app.all('/api/*', (c) => c.json({ error: 'No such endpoint.', code: 'not_found' }, 404))

// Everything else is the single-page app. A deep link that Vue handles on the
// client still has to return index.html, not a 404.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app

// ── Helpers ────────────────────────────────────────────────────────────────

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
    return body as Record<string, unknown>
  } catch {
    return {}
  }
}

function normalizeOrThrow(value: unknown): string {
  if (typeof value !== 'string' || !isValidAddress(value)) {
    throw new ApiError(400, 'That is not a valid Nimiq address.', 'bad_address')
  }
  return normalizeAddress(value)
}

async function requireMembership(env: Env, tabId: string, address: string): Promise<void> {
  const row = await env.DB.prepare('SELECT 1 FROM tab_members WHERE tab_id = ? AND address = ?')
    .bind(tabId, address)
    .first()
  if (!row) throw new ApiError(403, 'You are not in this tab.', 'not_member')
}

async function tabMemberAddresses(env: Env, tabId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT address FROM tab_members WHERE tab_id = ? ORDER BY joined_at ASC',
  )
    .bind(tabId)
    .all<{ address: string }>()
  return (results ?? []).map((r) => r.address)
}

async function memberDirectory(
  env: Env,
  addresses: string[],
): Promise<Array<{ address: string; displayName: string; avatarSeed: number }>> {
  const unique = [...new Set(addresses)].filter(Boolean)
  if (unique.length === 0) return []
  const placeholders = unique.map(() => '?').join(',')
  const { results } = await env.DB.prepare(
    `SELECT address, display_name, avatar_seed FROM users WHERE address IN (${placeholders})`,
  )
    .bind(...unique)
    .all<{ address: string; display_name: string; avatar_seed: number }>()
  return (results ?? []).map((r) => ({
    address: r.address,
    displayName: r.display_name,
    avatarSeed: r.avatar_seed,
  }))
}

async function uniqueInviteCode(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newInviteCode()
    const clash = await env.DB.prepare('SELECT 1 FROM tabs WHERE invite_code = ?').bind(code).first()
    if (!clash) return code
  }
  // 28^6 is about 480 million codes; eight collisions in a row means something
  // else is very wrong, so fail loudly rather than hand out a duplicate.
  throw new ApiError(503, 'Could not create a tab right now. Try again.', 'code_exhausted')
}

/**
 * Work out who owes what for one expense.
 *
 * Every mode goes through a splitter that is guaranteed to sum to the exact
 * total, because "the numbers do not add up" is the one bug a money app is
 * not allowed to have.
 */
function resolveShares(
  body: Record<string, unknown>,
  members: string[],
  amountLuna: number,
): Array<{ address: string; shareLuna: number }> {
  const mode = typeof body.splitMode === 'string' ? body.splitMode : 'equal'

  const participants = Array.isArray(body.participants)
    ? (body.participants as unknown[])
        .filter((p): p is string => typeof p === 'string')
        .map((p) => normalizeOrThrow(p))
        .filter((p) => members.includes(p))
    : members

  const unique = [...new Set(participants)]
  if (unique.length === 0) throw new ApiError(400, 'Pick at least one person to split with.', 'no_participants')

  if (mode === 'exact') {
    const raw = Array.isArray(body.shares) ? (body.shares as unknown[]) : []
    const shares: Array<{ address: string; shareLuna: number }> = []
    let total = 0
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      if (typeof e.address !== 'string') continue
      const address = normalizeOrThrow(e.address)
      if (!members.includes(address)) continue
      const value = typeof e.shareLuna === 'number' ? Math.floor(e.shareLuna) : NaN
      if (!Number.isFinite(value) || value < 0) {
        throw new ApiError(400, 'Every share has to be zero or more.', 'bad_share')
      }
      shares.push({ address, shareLuna: value })
      total += value
    }
    if (shares.length === 0) throw new ApiError(400, 'Enter the individual amounts.', 'no_shares')
    if (total !== amountLuna) {
      throw new ApiError(
        400,
        `Those shares add up to ${fmtNim(total)} NIM, but the expense is ${fmtNim(amountLuna)} NIM.`,
        'shares_mismatch',
      )
    }
    return shares.filter((s) => s.shareLuna > 0)
  }

  if (mode === 'shares') {
    const weightMap = new Map<string, number>()
    const raw = Array.isArray(body.shares) ? (body.shares as unknown[]) : []
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      if (typeof e.address !== 'string') continue
      const address = normalizeOrThrow(e.address)
      const weight = typeof e.weight === 'number' ? e.weight : 1
      if (!Number.isFinite(weight) || weight < 0) {
        throw new ApiError(400, 'Every share count has to be zero or more.', 'bad_weight')
      }
      weightMap.set(address, weight)
    }
    const weights = unique.map((a) => weightMap.get(a) ?? 1)
    const parts = splitByShares(amountLuna, weights)
    return unique.map((address, i) => ({ address, shareLuna: parts[i] })).filter((s) => s.shareLuna > 0)
  }

  const parts = splitEqually(amountLuna, unique.length)
  return unique.map((address, i) => ({ address, shareLuna: parts[i] })).filter((s) => s.shareLuna > 0)
}

function fmtNim(luna: number): string {
  return (luna / LUNA_PER_NIM).toLocaleString('en-US', { maximumFractionDigits: 5 })
}
