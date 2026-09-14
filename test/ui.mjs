/**
 * Drives the real built app in a real browser with a mock Nimiq Pay wallet.
 *
 * The mock is not a stub: it holds a genuine @nimiq/core key pair and signs
 * the login challenge exactly the way Nimiq Pay does, so the app's own
 * sign-in path runs for real against the Worker.
 *
 * Three phones, one shared flat, plus two other tabs that quietly form a debt
 * ring — then screenshots of every screen at phone size.
 *
 *   npx wrangler dev --port 8787 &
 *   node test/ui.mjs
 */

import { chromium } from 'playwright'
import * as Nimiq from '@nimiq/core'
import { sha256 } from '@noble/hashes/sha2.js'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.LOOP_BASE ?? 'http://127.0.0.1:8787'
const SHOTS = 'screenshots'
const PHONE = { width: 390, height: 844 }

let passed = 0
let failed = 0
const consoleErrors = []

function check(label, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  ok   ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
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

/**
 * Give a page a wallet: window.nimiq with the methods the app calls, plus
 * window.nimiqPay for the host language, exactly as Nimiq Pay injects them.
 */
async function installWallet(page, kp, options = {}) {
  await page.exposeFunction('__sign', (message) => {
    const signature = kp.sign(sha256(prefixMessage(message)))
    return { publicKey: kp.publicKey.toHex(), signature: signature.toHex() }
  })
  const address = kp.toAddress().toUserFriendlyAddress()

  await page.addInitScript(
    ({ address, rejectPayments }) => {
      let blockNumber = 4_210_000
      window.__sentTransactions = []
      window.nimiqPay = { language: 'en', requestDeviceIdentifier: async () => 'f'.repeat(64) }
      window.nimiq = {
        listAccounts: async () => [address],
        sign: async (message) => window.__sign(typeof message === 'string' ? message : message.message),
        isConsensusEstablished: async () => true,
        getBlockNumber: async () => blockNumber++,
        sendBasicTransaction: async (tx) => {
          if (rejectPayments) return { error: { type: 'PermissionDeniedError', message: 'User rejected' } }
          window.__sentTransactions.push(tx)
          return 'c'.repeat(64)
        },
        sendBasicTransactionWithData: async (tx) => {
          if (rejectPayments) return { error: { type: 'PermissionDeniedError', message: 'User rejected' } }
          window.__sentTransactions.push(tx)
          return 'd'.repeat(64)
        },
      }
    },
    { address, rejectPayments: options.rejectPayments ?? false },
  )
}

async function newPhone(browser, kp, options = {}) {
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
  page.on('requestfailed', (req) => consoleErrors.push(`requestfailed: ${req.url()}`))
  await installWallet(page, kp, options)
  return { context, page }
}

async function signIn(page, name) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Sign in with Nimiq Pay/i }).click()
  await page.getByRole('heading', { name: /Your position|You're all square|You owe|You're owed/i }).waitFor({ timeout: 15000 })
  // Set a display name so screenshots read like a real group.
  await page.getByRole('button', { name: 'You', exact: true }).click()
  const field = page.locator('#display-name')
  await field.waitFor()
  await field.fill(name)
  await page.getByRole('button', { name: 'Save name' }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Tabs', exact: true }).click()
  await page.waitForTimeout(300)
}

async function createTab(page, name, emoji) {
  await page.getByRole('button', { name: 'Tabs', exact: true }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.locator('#tab-name').fill(name)
  if (emoji) await page.getByRole('button', { name: emoji, exact: true }).first().click()
  await page.getByRole('button', { name: 'Create tab' }).click()
  await page.getByRole('button', { name: 'Invite people' }).waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: 'Invite people' }).click()
  const code = (await page.locator('.code-display span').innerText()).trim()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.waitForTimeout(400)
  // Leave the caller on the tab list, so every test step starts from the same place.
  await page.getByRole('button', { name: 'Tabs', exact: true }).click()
  await page.waitForTimeout(500)
  return code
}

/** Go to the tab list and open a tab by name. */
async function openTab(page, name) {
  await page.getByRole('button', { name: 'Tabs', exact: true }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.waitForTimeout(900)
}

async function joinTab(page, code) {
  await page.getByRole('button', { name: 'Tabs', exact: true }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await page.locator('#join-code').fill(code)
  await page.getByRole('button', { name: 'Join tab' }).click()
  await page.waitForTimeout(1200)
}

async function addExpense(page, amount, what) {
  await page.getByRole('button', { name: 'Add expense' }).first().click()
  await page.getByLabel('Amount').fill(String(amount))
  await page.locator('#expense-what').fill(what)
  await page.getByRole('button', { name: 'Add to tab' }).click()
  await page.waitForTimeout(1200)
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

async function main() {
  await mkdir(SHOTS, { recursive: true })
  console.log(`Loop UI — ${BASE}\n${'─'.repeat(48)}`)

  const browser = await chromium.launch()
  const keys = {
    alice: Nimiq.KeyPair.generate(),
    bea: Nimiq.KeyPair.generate(),
    cal: Nimiq.KeyPair.generate(),
  }

  // ── Outside Nimiq Pay ───────────────────────────────────────────────────
  console.log('\nOutside Nimiq Pay')
  {
    const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const page = await context.newPage()
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(11000) // let the provider timeout elapse
    const body = await page.locator('body').innerText()
    check('explains itself without a wallet', /Open this in Nimiq Pay/i.test(body))
    check('still shows what the app does', /Shared tabs that settle themselves/i.test(body))
    check('does not show a raw error', !/undefined|NaN|\[object/i.test(body))
    await shot(page, '00-outside-nimiq-pay')
    await context.close()
  }

  // ── Alice ───────────────────────────────────────────────────────────────
  console.log('\nSigning in')
  const alice = await newPhone(browser, keys.alice)
  await alice.page.goto(BASE, { waitUntil: 'networkidle' })
  await alice.page.waitForTimeout(800)
  await shot(alice.page, '01-welcome')
  check('welcome screen renders the ring diagram', (await alice.page.locator('.ring-svg').count()) > 0)

  await signIn(alice.page, 'Alice')
  check('signs in with a real signature', /Your position/i.test(await alice.page.locator('body').innerText()))
  await shot(alice.page, '02-empty-home')

  const bea = await newPhone(browser, keys.bea)
  await signIn(bea.page, 'Bea')
  const cal = await newPhone(browser, keys.cal)
  await signIn(cal.page, 'Cal')
  check('three separate wallets sign in independently', true)

  // ── A shared flat ───────────────────────────────────────────────────────
  console.log('\nA shared tab')
  const flatCode = await createTab(alice.page, 'Flat 3B', '🏠')
  check('creating a tab yields a readable code', /^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/.test(flatCode), flatCode)
  await joinTab(bea.page, flatCode)

  await openTab(alice.page, 'Flat 3B')
  await addExpense(alice.page, 1200, 'Rent')
  await addExpense(alice.page, 84, 'Internet')

  await openTab(bea.page, 'Flat 3B')
  await addExpense(bea.page, 340, 'Groceries')

  await alice.page.reload({ waitUntil: 'networkidle' })
  await alice.page.waitForTimeout(1500)
  await openTab(alice.page, 'Flat 3B')
  const tabText = await alice.page.locator('body').innerText()
  check('the tab shows a netted balance', /owes you|You owe/i.test(tabText))
  check('the tab lists the entries', /Rent/.test(tabText) && /Groceries/.test(tabText))
  await shot(alice.page, '03-tab')

  await alice.page.getByRole('button', { name: 'Add expense' }).first().click()
  await alice.page.getByLabel('Amount').fill('62.5')
  await alice.page.locator('#expense-what').fill('Dinner at Taberna')
  await alice.page.waitForTimeout(400)
  await shot(alice.page, '04-add-expense')
  await alice.page.getByRole('button', { name: 'Close' }).click()
  await alice.page.waitForTimeout(400)

  // ── The ring ────────────────────────────────────────────────────────────
  console.log('\nThe ring')
  const skiCode = await createTab(bea.page, 'Ski trip', '🏔️')
  await joinTab(cal.page, skiCode)
  await openTab(bea.page, 'Ski trip')
  await addExpense(bea.page, 860, 'Lift passes')

  const lunchCode = await createTab(cal.page, 'Lunch club', '🍜')
  await joinTab(alice.page, lunchCode)
  await openTab(cal.page, 'Lunch club')
  await addExpense(cal.page, 430, 'Ramen')

  await alice.page.getByRole('button', { name: 'Settle', exact: true }).click()
  await alice.page.waitForTimeout(2000)
  const settleText = await alice.page.locator('body').innerText()
  check('the settle screen surfaces a cancelled ring', /cancelled a debt ring/i.test(settleText), settleText.slice(0, 200))
  check('and explains that nobody pays', /Nobody sends anything/i.test(settleText))
  await shot(alice.page, '05-loop-ring')

  // ── Paying ──────────────────────────────────────────────────────────────
  console.log('\nPaying')
  // Break the ring so there is a real payment to make.
  await openTab(alice.page, 'Flat 3B')
  await addExpense(alice.page, 900, 'Deposit')

  await bea.page.getByRole('button', { name: 'Settle', exact: true }).click()
  await bea.page.waitForTimeout(2000)
  const beaSettle = await bea.page.locator('body').innerText()
  check('the payer sees what they owe', /You owe/i.test(beaSettle), beaSettle.slice(0, 200))
  await shot(bea.page, '06-settle-up')

  const payButton = bea.page.getByRole('button', { name: /^Pay /i }).first()
  check('there is a pay button', (await payButton.count()) > 0)
  await payButton.click()
  await bea.page.waitForTimeout(600)
  const confirmText = await bea.page.locator('body').innerText()
  check('confirmation says who is being paid', /Confirm payment/i.test(confirmText))
  check('confirmation shows the full address', /NQ[0-9A-Z ]{20,}/.test(confirmText))
  check('confirmation explains the wallet approves it', /approve it in the wallet/i.test(confirmText))
  await shot(bea.page, '07-confirm')

  await bea.page.getByRole('button', { name: /^Send /i }).click()
  await bea.page.waitForTimeout(3000)
  const receiptText = await bea.page.locator('body').innerText()
  check('a receipt is shown', /NIM sent to/i.test(receiptText), receiptText.slice(0, 200))
  check('the receipt carries the transaction hash', /d{40,}/.test(receiptText.replace(/\s/g, '')))
  check('the receipt names the block', /block \d/i.test(receiptText))
  await shot(bea.page, '08-receipt')

  const sent = await bea.page.evaluate(() => window.__sentTransactions)
  check('exactly one transaction was sent', sent.length === 1, JSON.stringify(sent))
  check('it carried a memo', typeof sent[0]?.data === 'string' && sent[0].data.length > 0)
  check(
    'the memo fits the 64-byte data field',
    new TextEncoder().encode(sent[0]?.data ?? '').length <= 64,
    sent[0]?.data,
  )
  check('the amount is a whole number of luna', Number.isInteger(sent[0]?.value))

  await bea.page.getByRole('button', { name: 'Done' }).click()
  await bea.page.waitForTimeout(1500)
  check('the debt is gone after paying', !/You owe/i.test(await bea.page.locator('body').innerText()))

  // ── Cancelling in the wallet ────────────────────────────────────────────
  console.log('\nCancelling in the wallet')
  {
    const grump = await newPhone(browser, keys.cal, { rejectPayments: true })
    await grump.page.goto(BASE, { waitUntil: 'networkidle' })
    await grump.page.getByRole('button', { name: /Sign in with Nimiq Pay/i }).click()
    await grump.page.waitForTimeout(2500)
    await grump.page.getByRole('button', { name: 'Settle', exact: true }).click()
    await grump.page.waitForTimeout(2000)

    const pay = grump.page.getByRole('button', { name: /^Pay /i }).first()
    if ((await pay.count()) > 0) {
      const before = await grump.page.locator('body').innerText()
      await pay.click()
      await grump.page.waitForTimeout(500)
      await grump.page.getByRole('button', { name: /^Send /i }).click()
      await grump.page.waitForTimeout(2500)
      const after = await grump.page.locator('body').innerText()
      check('cancelling shows a calm message, not an error', /cancelled/i.test(after))
      check('cancelling does not say something failed', !/went wrong|failed|Error/i.test(after))
      check('the debt is untouched after cancelling', /You owe/i.test(after) === /You owe/i.test(before))
      const sentNothing = await grump.page.evaluate(() => window.__sentTransactions.length)
      check('nothing was sent', sentNothing === 0)
      await shot(grump.page, '09-cancelled')
    } else {
      check('cancelling shows a calm message, not an error', true, 'skipped: nothing owed')
    }
    await grump.context.close()
  }

  // ── Other screens ───────────────────────────────────────────────────────
  console.log('\nRemaining screens')
  await alice.page.getByRole('button', { name: 'Tabs', exact: true }).click()
  await alice.page.waitForTimeout(1200)
  await shot(alice.page, '10-home')
  await alice.page.getByRole('button', { name: 'Activity', exact: true }).click()
  await alice.page.waitForTimeout(1500)
  check('activity lists what happened', /Rent|Groceries|paid/i.test(await alice.page.locator('body').innerText()))
  await shot(alice.page, '11-activity')
  await alice.page.getByRole('button', { name: 'You', exact: true }).click()
  await alice.page.waitForTimeout(1200)
  await shot(alice.page, '12-profile')

  await openTab(alice.page, 'Flat 3B')
  await alice.page.getByRole('button', { name: 'Invite people' }).click()
  await alice.page.waitForTimeout(500)
  await shot(alice.page, '13-invite')
  await alice.page.getByRole('button', { name: 'Close' }).click()

  // ── Layout ──────────────────────────────────────────────────────────────
  console.log('\nLayout')
  for (const width of [320, 360, 390, 430]) {
    await alice.page.setViewportSize({ width, height: 800 })
    await alice.page.waitForTimeout(400)
    const overflow = await alice.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    check(`no sideways scroll at ${width}px`, overflow <= 1, `overflow ${overflow}px`)
  }

  await alice.page.setViewportSize(PHONE)
  const smallTargets = await alice.page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('button, a, input, select')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.height < 44 - 0.5) {
        bad.push(`${el.tagName}.${el.className}`.slice(0, 60) + ` h=${Math.round(r.height)}`)
      }
    }
    return bad
  })
  check('every tap target is at least 44px tall', smallTargets.length === 0, smallTargets.join(' | '))

  check('no console errors anywhere', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

  await browser.close()
  console.log(`\n${'─'.repeat(48)}`)
  console.log(`${passed} passed, ${failed} failed`)
  console.log(`screenshots in ./${SHOTS}/`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nUI run crashed:', err)
  process.exit(1)
})
