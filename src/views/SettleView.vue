<script setup lang="ts">
/**
 * Settling up — the part that touches real money.
 *
 * Three things matter here and nothing else does:
 *
 *  - You always know exactly what you are paying, to whom, and why, BEFORE
 *    the wallet dialog appears.
 *  - Cancelling is a normal outcome. Tapping "no" in the wallet leaves the
 *    screen exactly as it was, with a calm line of text, not a red error.
 *  - The receipt is real. We record the transaction hash and the block it was
 *    sent at, and show them back.
 *
 * One payment, one deliberate tap. We never queue two wallet dialogs.
 */
import { computed, onMounted, ref } from 'vue'
import Avatar from '../components/Avatar.vue'
import LoopRing from '../components/LoopRing.vue'
import NimAmount from '../components/NimAmount.vue'
import Sheet from '../components/Sheet.vue'
import { api, ApiError, type Debt, type Member, type Plan } from '../lib/api.js'
import { formatNim, nameFor, pluralize, prettyAddress } from '../lib/format.js'
import {
  getBlockNumber,
  isConsensusEstablished,
  NimiqUnavailableError,
  sendPayment,
  UserRejectedError,
} from '../lib/nimiq.js'
import { refreshAll, screen, session, showToast } from '../lib/store.js'

const plan = ref<Plan | null>(null)
const directory = ref<Member[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

const confirmFor = ref<Debt | null>(null)
const paying = ref(false)
const payStatus = ref<string | null>(null)
const payError = ref<string | null>(null)

const receipt = ref<{ to: string; amountLuna: number; txHash: string; blockHeight: number | null } | null>(
  null,
)

const youOwe = computed(() => plan.value?.youOwe ?? [])
const owedToYou = computed(() => plan.value?.owedToYou ?? [])
const rings = computed(() => plan.value?.yourCycles ?? [])

const saved = computed(() => {
  const p = plan.value
  if (!p) return 0
  return Math.max(0, p.rawPaymentCount - p.debts.length)
})

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const result = await api.settle()
    plan.value = result.plan
    directory.value = result.members
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Could not load your balances.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function name(address: string): string {
  return nameFor(address, directory.value, session.address ?? undefined)
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function seed(address: string): number {
  return directory.value.find((m) => m.address === address)?.avatarSeed ?? 0
}

function openConfirm(debt: Debt) {
  payError.value = null
  payStatus.value = null
  confirmFor.value = debt
}

/**
 * The one place a payment happens.
 *
 * We tell the server first so there is a record if anything goes sideways,
 * then open the wallet. Whatever the wallet says — yes, no, or broken — the
 * server gets told, so a pending row never sits there pretending to be real.
 */
async function pay() {
  const debt = confirmFor.value
  if (!debt || paying.value) return

  paying.value = true
  payError.value = null
  let batchId: string | null = null

  try {
    payStatus.value = 'Checking the network…'
    const ready = await isConsensusEstablished().catch(() => true)
    if (!ready) {
      throw new Error('Your wallet is still syncing with the Nimiq network. Give it a moment.')
    }

    payStatus.value = 'Preparing…'
    const prepared = await api.prepareSettlement(debt.to, debt.amountLuna)
    batchId = prepared.batchId

    payStatus.value = 'Confirm in your wallet…'
    const txHash = await sendPayment(prepared.recipient, prepared.amountLuna, prepared.memo)

    payStatus.value = 'Recording…'
    const blockHeight = await getBlockNumber().catch(() => null)
    await api.confirmSettlement(batchId, txHash, blockHeight)

    receipt.value = { to: debt.to, amountLuna: debt.amountLuna, txHash, blockHeight }
    confirmFor.value = null
    await Promise.all([load(), refreshAll()])
  } catch (err) {
    // Whatever happened, do not leave a phantom pending payment behind.
    if (batchId) {
      const failed = !(err instanceof UserRejectedError)
      void api.cancelSettlement(batchId, failed).catch(() => {})
    }

    if (err instanceof UserRejectedError) {
      payError.value = null
      confirmFor.value = null
      showToast('Payment cancelled — nothing was sent.', 'info')
    } else if (err instanceof NimiqUnavailableError) {
      payError.value = 'Open Loop inside Nimiq Pay to send a payment.'
    } else {
      payError.value =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'The payment did not go through. Nothing was sent.'
    }
  } finally {
    paying.value = false
    payStatus.value = null
  }
}

/**
 * The wallet hands back a reference for the transaction it just sent. Where
 * that is a plain 32-byte hash we can point at a block explorer; where it is
 * something longer (a serialised transaction, depending on wallet version) we
 * still show it and let the user copy it, but we do not fabricate a link that
 * would 404.
 */
function isTxHash(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value.trim())
}

function explorerUrl(hash: string): string {
  return `https://nimiq.watch/#${hash.trim().toLowerCase()}`
}

async function copyHash(hash: string) {
  try {
    await navigator.clipboard.writeText(hash)
    showToast('Transaction hash copied', 'good')
  } catch {
    showToast('Could not copy — long-press to select it.', 'bad')
  }
}
</script>

<template>
  <div class="screen">
    <div class="wrap">
      <header class="head">
        <h1>Settle up</h1>
        <p class="muted small">Everything you have going with everyone, in one place.</p>
      </header>

      <p v-if="loadError" class="error card" role="alert">
        {{ loadError }}
        <button class="btn btn--ghost btn--sm" type="button" @click="load">Try again</button>
      </p>

      <template v-else-if="loading">
        <div class="skeleton block-skeleton" />
        <div class="skeleton block-skeleton" />
      </template>

      <template v-else>
        <!-- The headline: what Loop removed before you have to pay anything. -->
        <section v-if="rings.length > 0" class="rings">
          <div v-for="(ring, i) in rings" :key="i" class="card ring-card">
            <p class="label">Loop cancelled a debt ring</p>
            <LoopRing
              :members="ring.members"
              :amount-luna="ring.amountLuna"
              :directory="directory"
              :self="session.address"
            />
            <p class="ring-note small">
              Nobody sends anything. The debt went in a circle, so Loop removed
              {{ formatNim(ring.amountLuna) }} NIM from every step of it at once.
            </p>
          </div>
        </section>

        <section v-if="youOwe.length > 0" class="section">
          <h2 class="section-head">You owe</h2>
          <ul class="pay-list">
            <li v-for="d in youOwe" :key="`${d.from}-${d.to}`">
              <div class="pay-card">
                <Avatar :name="name(d.to)" :seed="seed(d.to)" />
                <div class="pay-body">
                  <p class="pay-name">{{ cap(name(d.to)) }}</p>
                  <p class="tiny muted mono">{{ prettyAddress(d.to).slice(0, 14) }}…</p>
                </div>
                <NimAmount :luna="d.amountLuna" size="md" fiat class="pay-amount" />
              </div>
              <button class="btn btn--green btn--block" type="button" @click="openConfirm(d)">
                Pay {{ formatNim(d.amountLuna) }} NIM
              </button>
            </li>
          </ul>
        </section>

        <section v-if="owedToYou.length > 0" class="section">
          <h2 class="section-head">Owed to you</h2>
          <ul class="owed-list">
            <li v-for="d in owedToYou" :key="`${d.from}-${d.to}`" class="owed-row">
              <Avatar :name="name(d.from)" :seed="seed(d.from)" />
              <div class="pay-body">
                <p class="pay-name">{{ cap(name(d.from)) }}</p>
                <p class="tiny muted">will settle from their side</p>
              </div>
              <NimAmount :luna="d.amountLuna" size="md" class="owed-amount" />
            </li>
          </ul>
        </section>

        <section v-if="youOwe.length === 0 && owedToYou.length === 0" class="empty card">
          <span class="empty-mark" aria-hidden="true">🎉</span>
          <h3>You're completely square</h3>
          <p class="small muted">
            Nothing owed either way. Add something to a tab and this fills back up.
          </p>
          <button class="btn btn--ghost" type="button" @click="screen = 'home'">Back to tabs</button>
        </section>

        <p v-if="saved > 0" class="footnote small muted">
          Without Loop this would have been
          <strong>{{ plan?.rawPaymentCount }}</strong>
          separate {{ pluralize(plan?.rawPaymentCount ?? 0, 'payment') }}. Netting and ring-cancellation
          brought it down to <strong>{{ plan?.debts.length }}</strong>.
        </p>
      </template>
    </div>

    <!-- Confirmation. Everything the wallet is about to ask about, in advance. -->
    <Sheet :open="confirmFor !== null" title="Confirm payment" @close="!paying && (confirmFor = null)">
      <div v-if="confirmFor" class="stack confirm">
        <div class="confirm-amount">
          <NimAmount :luna="confirmFor.amountLuna" size="xl" fiat />
        </div>

        <dl class="detail">
          <div>
            <dt class="label">To</dt>
            <dd>
              <div class="row">
                <Avatar :name="name(confirmFor.to)" :seed="seed(confirmFor.to)" size="sm" />
                <strong>{{ cap(name(confirmFor.to)) }}</strong>
              </div>
              <p class="tiny muted mono address">{{ prettyAddress(confirmFor.to) }}</p>
            </dd>
          </div>
          <div>
            <dt class="label">What for</dt>
            <dd class="small">
              Clears everything you owe {{ name(confirmFor.to) }} across all your shared tabs.
            </dd>
          </div>
          <div>
            <dt class="label">How</dt>
            <dd class="small">
              A NIM transfer from your Nimiq Pay wallet. You'll approve it in the wallet's own
              dialog — Loop never touches your keys.
            </dd>
          </div>
        </dl>

        <p v-if="payStatus" class="status small" aria-live="polite">
          <span class="status-dot" aria-hidden="true" />{{ payStatus }}
        </p>
        <p v-if="payError" class="field-error" role="alert">{{ payError }}</p>

        <button class="btn btn--green btn--block" type="button" :disabled="paying" @click="pay">
          {{ paying ? 'Waiting for your wallet…' : `Send ${formatNim(confirmFor.amountLuna)} NIM` }}
        </button>
        <button class="btn btn--quiet btn--block" type="button" :disabled="paying" @click="confirmFor = null">
          Not now
        </button>
      </div>
    </Sheet>

    <!-- Receipt. -->
    <Sheet :open="receipt !== null" title="Paid" @close="receipt = null">
      <div v-if="receipt" class="stack done">
        <div class="done-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12l6 6L20 6" />
          </svg>
        </div>
        <h3 class="done-title">
          {{ formatNim(receipt.amountLuna) }} NIM sent to {{ name(receipt.to) }}
        </h3>
        <p class="small muted">
          It's on the Nimiq network now. Your tabs have been updated.
        </p>

        <div class="receipt">
          <p class="label">Transaction</p>
          <button class="receipt-hash mono tiny" type="button" @click="copyHash(receipt.txHash)">
            {{ receipt.txHash }}
          </button>
          <p v-if="receipt.blockHeight" class="tiny muted">
            Sent at block {{ receipt.blockHeight.toLocaleString() }}
          </p>
          <a
            v-if="isTxHash(receipt.txHash)"
            class="tiny"
            :href="explorerUrl(receipt.txHash)"
            target="_blank"
            rel="noopener"
          >
            View on the block explorer →
          </a>
          <p v-else class="tiny muted">
            Your wallet's history has the full record of this payment.
          </p>
        </div>

        <button class="btn btn--primary btn--block" type="button" @click="receipt = null">Done</button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.head {
  padding-top: calc(env(safe-area-inset-top) + 20px);
  margin-bottom: 18px;
}

.head p {
  margin-top: 4px;
}

.block-skeleton {
  height: 120px;
  border-radius: var(--radius-lg);
  margin-bottom: 12px;
}

.error {
  color: var(--nq-red);
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}

.rings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.ring-card {
  border: 2px solid rgba(33, 188, 165, 0.25);
  background: linear-gradient(180deg, rgba(33, 188, 165, 0.06), var(--surface) 60%);
  text-align: center;
}

.ring-note {
  margin-top: 10px;
  color: var(--ink-70);
  line-height: 1.5;
}

.section {
  margin-bottom: 28px;
}

.section-head {
  margin-bottom: 12px;
}

.pay-list,
.owed-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pay-list > li {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.pay-card,
.owed-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.owed-row {
  padding: 14px 16px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.pay-body {
  flex: 1 1 auto;
  min-width: 0;
}

.pay-name {
  font-weight: 800;
  font-size: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pay-amount :deep(.amount-main) {
  color: var(--owe);
}

.owed-amount :deep(.amount-main) {
  color: var(--owed);
}

.empty {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 20px;
}

.empty-mark {
  font-size: 36px;
}

.empty p {
  max-width: 30ch;
  line-height: 1.5;
}

.footnote {
  line-height: 1.5;
  text-align: center;
  padding: 0 8px;
}

.footnote strong {
  color: var(--ink);
}

.confirm {
  padding-bottom: 8px;
}

.confirm-amount {
  display: flex;
  justify-content: center;
  padding: 8px 0 16px;
}

.confirm-amount :deep(.amount) {
  align-items: center;
}

.detail {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: var(--radius-lg);
  background: var(--surface-sunken);
}

.detail > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail dd {
  margin: 0;
  line-height: 1.45;
}

.address {
  margin-top: 4px;
  word-break: break-all;
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  color: var(--ink-70);
  font-weight: 600;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--nq-light-blue);
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}

.done {
  align-items: center;
  text-align: center;
  padding-bottom: 8px;
}

.done-mark {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(33, 188, 165, 0.14);
  color: var(--nq-green);
  margin-top: 4px;
}

.done-title {
  font-size: 18px;
}

.receipt {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: var(--radius-lg);
  background: var(--surface-sunken);
  text-align: left;
}

.receipt-hash {
  word-break: break-all;
  text-align: left;
  color: var(--ink-70);
  line-height: 1.5;
  padding: 0;
}
</style>
