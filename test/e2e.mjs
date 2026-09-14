/**
 * End-to-end test against a real running Worker with a real D1 database.
 *
 * Uses actual @nimiq/core key pairs and signs the login challenge exactly the
 * way Nimiq Pay does, so the signature path is exercised for real rather than
 * stubbed. Three people, three tabs, a debt ring, and a settlement.
 *
 *   npx wrangler dev --port 8787 &
 *   node test/e2e.mjs
 */

import * as Nimiq from '@nimiq/core'
import { sha256 } from '@noble/hashes/sha2.js'

const BASE = process.env.LOOP_BASE ?? 'http://127.0.0.1:8787'
const NIM = 100_000

let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  ok   ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(name) {
  console.log(`\n${name}`)
}

async function call(method, path, { body, token } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  return { status: res.status, data }
}

function prefixMessage(message) {
  const enc = new TextEncoder()
  const msg = enc.encode(message)
  const prefix = enc.encode('\x16Nimiq Signed Message:\n')
  const len = enc.encode(String(msg.length))
  const out = new Uint8Array(prefix.length + len.length + msg.length)
  out.set(prefix, 0)
  out.set(len, prefix.length)
  out.set(msg, prefix.length + len.length)
  return out
}

/** A fake wallet: holds a key, signs challenges the way Nimiq Pay signs them. */
function makeWallet(name) {
  const kp = Nimiq.KeyPair.generate()
  return {
    name,
    kp,
    address: kp.toAddress().toUserFriendlyAddress().replace(/\s/g, ''),
    token: null,
    sign(message) {
      const signature = kp.sign(sha256(prefixMessage(message)))
      return { publicKey: kp.publicKey.toHex(), signature: signature.toHex() }
    },
  }
}

async function signIn(wallet) {
  const { data: challenge } = await call('POST', '/auth/challenge', { body: {} })
  const signed = wallet.sign(challenge.message)
  const { status, data } = await call('POST', '/auth/login', {
    body: {
      nonce: challenge.nonce,
      publicKey: signed.publicKey,
      signature: signed.signature,
      address: wallet.address,
    },
  })
  if (status !== 200) throw new Error(`login failed for ${wallet.name}: ${JSON.stringify(data)}`)
  wallet.token = data.token
  await call('PATCH', '/me', { token: data.token, body: { displayName: wallet.name } })
  return data
}

async function main() {
  console.log(`Loop end-to-end — ${BASE}\n${'─'.repeat(48)}`)

  const alice = makeWallet('Alice')
  const bea = makeWallet('Bea')
  const cal = makeWallet('Cal')

  const ringsBefore = (await call('GET', '/stats')).data.rings

  // ── Auth ────────────────────────────────────────────────────────────────
  section('Authentication')

  const aliceLogin = await signIn(alice)
  check('signs in with a real Nimiq signature', aliceLogin.token?.length > 0)
  check(
    'derives the address from the public key',
    aliceLogin.address === alice.address,
    `${aliceLogin.address} vs ${alice.address}`,
  )
  check('flags a first-time user', aliceLogin.isNewUser === true)

  await signIn(bea)
  await signIn(cal)

  {
    const { data: challenge } = await call('POST', '/auth/challenge', { body: {} })
    const signed = alice.sign(challenge.message)
    const first = await call('POST', '/auth/login', {
      body: { nonce: challenge.nonce, publicKey: signed.publicKey, signature: signed.signature },
    })
    const replay = await call('POST', '/auth/login', {
      body: { nonce: challenge.nonce, publicKey: signed.publicKey, signature: signed.signature },
    })
    check('accepts a challenge once', first.status === 200)
    check('rejects the same challenge twice', replay.status === 401, `got ${replay.status}`)
  }

  {
    const { data: challenge } = await call('POST', '/auth/challenge', { body: {} })
    const signed = bea.sign(challenge.message)
    const res = await call('POST', '/auth/login', {
      body: {
        nonce: challenge.nonce,
        publicKey: signed.publicKey,
        signature: signed.signature,
        address: alice.address, // claiming to be somebody else
      },
    })
    check('rejects a signature that does not match the claimed address', res.status === 401)
  }

  {
    const { data: challenge } = await call('POST', '/auth/challenge', { body: {} })
    const signed = bea.sign('a completely different message')
    const res = await call('POST', '/auth/login', {
      body: { nonce: challenge.nonce, publicKey: signed.publicKey, signature: signed.signature },
    })
    check('rejects a signature over the wrong message', res.status === 401)
  }

  check('rejects a request with no token', (await call('GET', '/me')).status === 401)
  check(
    'rejects a made-up token',
    (await call('GET', '/me', { token: 'not-a-real-token' })).status === 401,
  )

  // ── Tabs ────────────────────────────────────────────────────────────────
  section('Tabs and membership')

  const { data: flat } = await call('POST', '/tabs', {
    token: alice.token,
    body: { name: 'Flat 3B', emoji: '🏠' },
  })
  check('creates a tab', typeof flat.id === 'string' && flat.inviteCode?.length === 6)
  check('invite code avoids vowels and lookalikes', /^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/.test(flat.inviteCode))

  const joined = await call('POST', '/tabs/join', {
    token: bea.token,
    body: { inviteCode: flat.inviteCode },
  })
  check('a second person joins with the code', joined.status === 200 && joined.data.id === flat.id)

  const rejoined = await call('POST', '/tabs/join', {
    token: bea.token,
    body: { inviteCode: flat.inviteCode },
  })
  check('joining twice is harmless', rejoined.status === 200 && rejoined.data.alreadyMember === true)

  const badJoin = await call('POST', '/tabs/join', {
    token: cal.token,
    body: { inviteCode: 'ZZZZZZ' },
  })
  check('a wrong code is refused clearly', badJoin.status === 404 && typeof badJoin.data.error === 'string')

  const outsider = await call('GET', `/tabs/${flat.id}`, { token: cal.token })
  check('a non-member cannot read the tab', outsider.status === 403)

  const outsiderWrite = await call('POST', `/tabs/${flat.id}/expenses`, {
    token: cal.token,
    body: { amountLuna: 100 * NIM, description: 'sneaky' },
  })
  check('a non-member cannot add an expense', outsiderWrite.status === 403)

  // ── Expenses ────────────────────────────────────────────────────────────
  section('Expenses and splitting')

  const rent = await call('POST', `/tabs/${flat.id}/expenses`, {
    token: alice.token,
    body: { amountLuna: 1000 * NIM, description: 'Rent', splitMode: 'equal' },
  })
  check('adds an evenly split expense', rent.status === 200)
  check(
    'the even split sums to the exact total',
    rent.data.shares.reduce((s, x) => s + x.shareLuna, 0) === 1000 * NIM,
  )

  const odd = await call('POST', `/tabs/${flat.id}/expenses`, {
    token: alice.token,
    body: { amountLuna: 3 * NIM + 1, description: 'Odd luna', splitMode: 'equal' },
  })
  check(
    'an amount that does not divide evenly still sums exactly',
    odd.data.shares.reduce((s, x) => s + x.shareLuna, 0) === 3 * NIM + 1,
  )
  await call('DELETE', `/tabs/${flat.id}/expenses/${odd.data.id}`, { token: alice.token })

  const badExact = await call('POST', `/tabs/${flat.id}/expenses`, {
    token: alice.token,
    body: {
      amountLuna: 500 * NIM,
      description: 'Mismatched',
      splitMode: 'exact',
      shares: [
        { address: alice.address, shareLuna: 100 * NIM },
        { address: bea.address, shareLuna: 100 * NIM },
      ],
    },
  })
  check('refuses exact shares that do not add up', badExact.status === 400)
  check('and explains by how much', /NIM/.test(badExact.data.error ?? ''))

  const goodExact = await call('POST', `/tabs/${flat.id}/expenses`, {
    token: bea.token,
    body: {
      amountLuna: 500 * NIM,
      description: 'Groceries',
      splitMode: 'exact',
      shares: [
        { address: alice.address, shareLuna: 300 * NIM },
        { address: bea.address, shareLuna: 200 * NIM },
      ],
    },
  })
  check('accepts exact shares that do add up', goodExact.status === 200)

  for (const bad of [
    { amountLuna: 0, label: 'zero' },
    { amountLuna: -100, label: 'negative' },
    { amountLuna: 1.5, label: 'fractional luna' },
    { amountLuna: 'lots', label: 'non-numeric' },
    { amountLuna: 9e18, label: 'absurdly large' },
  ]) {
    const res = await call('POST', `/tabs/${flat.id}/expenses`, {
      token: alice.token,
      body: { amountLuna: bad.amountLuna, description: 'bad' },
    })
    check(`rejects a ${bad.label} amount`, res.status === 400)
  }

  // ── Balances ────────────────────────────────────────────────────────────
  section('Balances')

  const flatDetail = await call('GET', `/tabs/${flat.id}`, { token: alice.token })
  // Alice paid 1000 (500 each). Bea paid 500 (Alice 300, Bea 200).
  // Bea owes Alice 500; Alice owes Bea 300. Net: Bea owes Alice 200.
  const debts = flatDetail.data.debts
  check('nets the pair down to one debt', debts.length === 1, JSON.stringify(debts))
  check(
    'and gets the direction and amount right',
    debts[0]?.from === bea.address && debts[0]?.to === alice.address && debts[0]?.amountLuna === 200 * NIM,
    JSON.stringify(debts[0]),
  )

  // ── The ring ────────────────────────────────────────────────────────────
  section('Cross-tab ring cancellation')

  // Alice→Bea in one tab, Bea→Cal in another, Cal→Alice in a third. Nobody can
  // see the ring from inside their own tab.
  const { data: ski } = await call('POST', '/tabs', {
    token: bea.token,
    body: { name: 'Ski trip', emoji: '🏔️' },
  })
  await call('POST', '/tabs/join', { token: cal.token, body: { inviteCode: ski.inviteCode } })

  const { data: lunch } = await call('POST', '/tabs', {
    token: cal.token,
    body: { name: 'Lunch club', emoji: '🍜' },
  })
  await call('POST', '/tabs/join', { token: alice.token, body: { inviteCode: lunch.inviteCode } })

  // Bea pays 400 in the ski tab, split with Cal → Cal owes Bea 200.
  await call('POST', `/tabs/${ski.id}/expenses`, {
    token: bea.token,
    body: { amountLuna: 400 * NIM, description: 'Lift passes', splitMode: 'equal' },
  })
  // Cal pays 400 in the lunch tab, split with Alice → Alice owes Cal 200.
  await call('POST', `/tabs/${lunch.id}/expenses`, {
    token: cal.token,
    body: { amountLuna: 400 * NIM, description: 'Ramen', splitMode: 'equal' },
  })

  // Ring so far: Bea→Alice 200 (flat), Cal→Bea 200 (ski), Alice→Cal 200 (lunch).
  const settle = await call('GET', '/settle', { token: alice.token })
  const plan = settle.data.plan
  check('finds the ring nobody could see from one tab', plan.cancelledCycles.length === 1, JSON.stringify(plan.cancelledCycles))
  check('cancels it completely', plan.debts.length === 0, JSON.stringify(plan.debts))
  check('counts the erased debt', plan.cancelledLuna === 600 * NIM, String(plan.cancelledLuna))
  check(
    'reports the true pre-netting baseline',
    plan.rawPaymentCount === 3,
    String(plan.rawPaymentCount),
  )
  check('leaves Alice owing nothing', plan.youOwe.length === 0)

  const beaSettle = await call('GET', '/settle', { token: bea.token })
  check('every member of the ring sees it', beaSettle.data.plan.yourCycles.length === 1)

  // Counts are deltas, so the suite can be run repeatedly against one database.
  const stats = await call('GET', '/stats')
  check('the ring is logged', stats.data.rings === ringsBefore + 1, `${ringsBefore} -> ${stats.data.rings}`)
  await call('GET', '/settle', { token: cal.token })
  await call('GET', '/settle', { token: bea.token })
  const stats2 = await call('GET', '/stats')
  check(
    're-spotting the same ring does not log it again',
    stats2.data.rings === ringsBefore + 1,
    `${ringsBefore} -> ${stats2.data.rings}`,
  )

  // ── Settling ────────────────────────────────────────────────────────────
  section('Settling with NIM')

  // Break the ring so there is something real to pay.
  await call('POST', `/tabs/${flat.id}/expenses`, {
    token: alice.token,
    body: { amountLuna: 1000 * NIM, description: 'Deposit', splitMode: 'equal' },
  })

  const before = await call('GET', '/settle', { token: bea.token })
  const owed = before.data.plan.youOwe[0]
  check('Bea now owes something real', !!owed, JSON.stringify(before.data.plan))

  if (owed) {
    const over = await call('POST', '/settle/prepare', {
      token: bea.token,
      body: { toAddr: owed.to, amountLuna: owed.amountLuna + 1 },
    })
    check('refuses to pay more than is owed', over.status === 400)

    const self = await call('POST', '/settle/prepare', {
      token: bea.token,
      body: { toAddr: bea.address, amountLuna: 100 },
    })
    check('refuses a payment to yourself', self.status === 400)

    const prepared = await call('POST', '/settle/prepare', {
      token: bea.token,
      body: { toAddr: owed.to, amountLuna: owed.amountLuna },
    })
    check('prepares a payment', prepared.status === 200)
    check(
      'the memo fits in the 64-byte data field',
      new TextEncoder().encode(prepared.data.memo).length <= 64,
      prepared.data.memo,
    )

    // Pending must not move any balance — the wallet dialog has not been answered yet.
    const during = await call('GET', '/settle', { token: bea.token })
    check(
      'a pending payment changes nothing',
      during.data.plan.youOwe[0]?.amountLuna === owed.amountLuna,
    )

    // The user cancels in the wallet.
    await call('POST', '/settle/cancel', { token: bea.token, body: { batchId: prepared.data.batchId } })
    const afterCancel = await call('GET', '/settle', { token: bea.token })
    check(
      'cancelling in the wallet leaves the debt exactly as it was',
      afterCancel.data.plan.youOwe[0]?.amountLuna === owed.amountLuna,
    )

    // Now do it for real.
    const prepared2 = await call('POST', '/settle/prepare', {
      token: bea.token,
      body: { toAddr: owed.to, amountLuna: owed.amountLuna },
    })
    const confirmed = await call('POST', '/settle/confirm', {
      token: bea.token,
      body: { batchId: prepared2.data.batchId, txHash: 'a'.repeat(64), blockHeight: 4210000 },
    })
    check('confirms with a transaction hash', confirmed.status === 200)

    const replay = await call('POST', '/settle/confirm', {
      token: bea.token,
      body: { batchId: prepared2.data.batchId, txHash: 'b'.repeat(64), blockHeight: 4210001 },
    })
    check('will not confirm the same payment twice', replay.status === 404)

    const after = await call('GET', '/settle', { token: bea.token })
    const stillOwed = after.data.plan.youOwe.find((d) => d.to === owed.to)
    check('the debt is gone once paid', !stillOwed, JSON.stringify(after.data.plan.youOwe))

    const tabAfter = await call('GET', `/tabs/${flat.id}`, { token: alice.token })
    check('the payment shows inside the tab it cleared', tabAfter.data.settlements.length >= 1)
    check(
      'and the tab records the block height',
      tabAfter.data.settlements[0]?.blockHeight === 4210000,
    )
  }

  // ── Leaving ─────────────────────────────────────────────────────────────
  section('Leaving a tab')

  const { data: solo } = await call('POST', '/tabs', {
    token: cal.token,
    body: { name: 'Temp', emoji: '🧾' },
  })
  await call('POST', '/tabs/join', { token: alice.token, body: { inviteCode: solo.inviteCode } })
  await call('POST', `/tabs/${solo.id}/expenses`, {
    token: cal.token,
    body: { amountLuna: 100 * NIM, description: 'Coffee', splitMode: 'equal' },
  })
  const blockedLeave = await call('POST', `/tabs/${solo.id}/leave`, { token: alice.token })
  check('cannot walk away from an open balance', blockedLeave.status === 400)

  // ── Odds and ends ───────────────────────────────────────────────────────
  section('Edge cases')

  check(
    'unknown endpoints 404 cleanly',
    (await call('GET', '/nope', { token: alice.token })).status === 404,
  )

  const malformed = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  })
  check('malformed JSON does not crash the worker', malformed.status === 400)

  const price = await call('GET', '/price?currency=usd')
  check('the price endpoint always answers', price.status === 200)
  const badCurrency = await call('GET', '/price?currency=<script>')
  check('a hostile currency code is rejected', badCurrency.status === 400)

  const longName = await call('POST', '/tabs', {
    token: alice.token,
    body: { name: 'x'.repeat(500), emoji: '🧾' },
  })
  check('a very long tab name is truncated, not rejected', longName.status === 200 && longName.data.name.length <= 60)

  const emptyName = await call('POST', '/tabs', { token: alice.token, body: { name: '   ' } })
  check('an empty tab name is refused', emptyName.status === 400)

  const spa = await fetch(`${BASE}/some/deep/link`)
  check('unknown pages fall through to the app', spa.status === 200)

  console.log(`\n${'─'.repeat(48)}`)
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nTest run crashed:', err)
  process.exit(1)
})
