<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AddExpenseSheet from '../components/AddExpenseSheet.vue'
import Avatar from '../components/Avatar.vue'
import NimAmount from '../components/NimAmount.vue'
import Sheet from '../components/Sheet.vue'
import { api, ApiError, type TabDetail } from '../lib/api.js'
import { formatNim, nameFor, pluralize, relativeTime, shortAddress } from '../lib/format.js'
import { activeTabId, refreshAll, screen, session, showToast } from '../lib/store.js'

const detail = ref<TabDetail | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const addOpen = ref(false)
const inviteOpen = ref(false)
const copied = ref(false)

const members = computed(() => detail.value?.members ?? [])

/** Who owes whom inside this tab, after Loop has rebalanced it. */
const myDebts = computed(() =>
  (detail.value?.debts ?? []).filter((d) => d.from === session.address),
)
const myCredits = computed(() =>
  (detail.value?.debts ?? []).filter((d) => d.to === session.address),
)
const otherDebts = computed(() =>
  (detail.value?.debts ?? []).filter(
    (d) => d.from !== session.address && d.to !== session.address,
  ),
)

/** The Nimiq Pay deeplink, so tapping the link elsewhere opens the mini app. */
const deepLink = computed(() => {
  if (!detail.value) return ''
  const host = `${window.location.host}${window.location.pathname}`.replace(/\/$/, '')
  return `https://nimpay.app/miniapps/open/${host}?join=${detail.value.tab.inviteCode}`
})

async function load() {
  const id = activeTabId.value
  if (!id) {
    screen.value = 'home'
    return
  }
  loading.value = true
  loadError.value = null
  try {
    detail.value = await api.tab(id)
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Could not open that tab.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(activeTabId, load)

async function onExpenseAdded() {
  await Promise.all([load(), refreshAll()])
}

async function removeExpense(expenseId: string) {
  const id = activeTabId.value
  if (!id) return
  try {
    await api.removeExpense(id, expenseId)
    await onExpenseAdded()
    showToast('Removed', 'info')
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Could not remove that.', 'bad')
  }
}

async function share() {
  const text = `Join "${detail.value?.tab.name}" on Loop — code ${detail.value?.tab.inviteCode}`
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Loop', text, url: deepLink.value })
      return
    }
  } catch {
    // Share sheet dismissed. Fall through to copying.
  }
  await copy(deepLink.value)
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    showToast('Copied', 'good')
    window.setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    showToast('Could not copy — long-press to select it instead.', 'bad')
  }
}

function goSettle() {
  screen.value = 'settle'
}

function back() {
  screen.value = 'home'
}

function name(address: string): string {
  return nameFor(address, members.value, session.address ?? undefined)
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function seed(address: string): number {
  return members.value.find((m) => m.address === address)?.avatarSeed ?? 0
}
</script>

<template>
  <div class="screen">
    <div class="wrap">
      <header class="head">
        <button class="back" type="button" aria-label="Back to tabs" @click="back">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div class="head-text">
          <h1 v-if="detail" class="head-title">
            <span aria-hidden="true">{{ detail.tab.emoji }}</span> {{ detail.tab.name }}
          </h1>
          <div v-else class="skeleton head-skeleton" />
          <p v-if="detail" class="tiny muted">
            {{ members.length }} {{ pluralize(members.length, 'person', 'people') }}
            · {{ formatNim(detail.totalSpentLuna) }} NIM tracked
          </p>
        </div>
        <button v-if="detail" class="back" type="button" aria-label="Invite people" @click="inviteOpen = true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="8" r="4" />
            <path d="M2 21v-1a6 6 0 0 1 6-6h2" />
            <path d="M18 8v8M14 12h8" />
          </svg>
        </button>
      </header>

      <p v-if="loadError" class="error card" role="alert">
        {{ loadError }}
        <button class="btn btn--ghost btn--sm" type="button" @click="load">Try again</button>
      </p>

      <template v-else-if="loading">
        <div class="skeleton block-skeleton" />
        <div class="skeleton block-skeleton" />
      </template>

      <template v-else-if="detail">
        <section class="card balances">
          <p class="label">Where this tab stands</p>

          <p v-if="detail.debts.length === 0" class="settled">
            <span class="settled-mark" aria-hidden="true">✓</span>
            Everyone's square.
          </p>

          <template v-else>
            <ul class="debt-list">
              <li v-for="d in myDebts" :key="`${d.from}-${d.to}`" class="debt">
                <Avatar :name="name(d.to)" :seed="seed(d.to)" size="sm" />
                <span class="debt-text">You owe <strong>{{ name(d.to) }}</strong></span>
                <NimAmount :luna="d.amountLuna" size="sm" class="owe-amount" />
              </li>
              <li v-for="d in myCredits" :key="`${d.from}-${d.to}`" class="debt">
                <Avatar :name="name(d.from)" :seed="seed(d.from)" size="sm" />
                <span class="debt-text"><strong>{{ cap(name(d.from)) }}</strong> owes you</span>
                <NimAmount :luna="d.amountLuna" size="sm" class="owed-amount" />
              </li>
              <li v-for="d in otherDebts" :key="`${d.from}-${d.to}`" class="debt debt--other">
                <Avatar :name="name(d.from)" :seed="seed(d.from)" size="sm" />
                <span class="debt-text muted">
                  {{ cap(name(d.from)) }} owes {{ name(d.to) }}
                </span>
                <NimAmount :luna="d.amountLuna" size="sm" />
              </li>
            </ul>

            <p class="rebalance-note tiny muted">
              Loop rebalanced this tab down to
              {{ detail.debts.length }} {{ pluralize(detail.debts.length, 'payment') }} — everyone
              ends up exactly where the receipts say, with fewer transfers.
            </p>

            <button v-if="myDebts.length > 0" class="btn btn--green btn--block" type="button" @click="goSettle">
              Settle up
            </button>
          </template>
        </section>

        <section class="section">
          <div class="row row--between section-head">
            <h2>Entries</h2>
            <button class="btn btn--primary btn--sm" type="button" @click="addOpen = true">
              Add expense
            </button>
          </div>

          <div v-if="detail.expenses.length === 0" class="empty card">
            <span class="empty-mark" aria-hidden="true">🧮</span>
            <h3>Nothing on this tab yet</h3>
            <p class="small muted">
              Add the first thing somebody paid for. Loop works out who owes what from there.
            </p>
            <button class="btn btn--primary" type="button" @click="addOpen = true">Add expense</button>
          </div>

          <ul v-else class="entries">
            <li v-for="e in detail.expenses" :key="e.id" class="entry">
              <Avatar :name="name(e.payer)" :seed="seed(e.payer)" />
              <div class="entry-body">
                <p class="entry-what">{{ e.description }}</p>
                <p class="entry-meta tiny muted">
                  {{ cap(name(e.payer)) }} paid · split {{ e.shares.length }} {{ pluralize(e.shares.length, 'way', 'ways') }}
                  · {{ relativeTime(e.createdAt) }}
                </p>
              </div>
              <div class="entry-right">
                <NimAmount :luna="e.amountLuna" size="sm" />
                <button
                  class="entry-remove tiny"
                  type="button"
                  :aria-label="`Remove ${e.description}`"
                  @click="removeExpense(e.id)"
                >
                  Remove
                </button>
              </div>
            </li>
          </ul>
        </section>

        <section v-if="detail.settlements.length > 0" class="section">
          <h2 class="section-head">Payments</h2>
          <ul class="entries">
            <li v-for="s in detail.settlements" :key="s.id" class="entry">
              <span class="paid-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 12l6 6L20 6" />
                </svg>
              </span>
              <div class="entry-body">
                <p class="entry-what">
                  {{ cap(name(s.fromAddr)) }} paid {{ name(s.toAddr) }}
                </p>
                <p class="entry-meta tiny muted">
                  {{ relativeTime(s.createdAt) }}
                  <template v-if="s.blockHeight"> · block {{ s.blockHeight.toLocaleString() }}</template>
                </p>
              </div>
              <NimAmount :luna="s.amountLuna" size="sm" />
            </li>
          </ul>
        </section>

        <section class="section">
          <h2 class="section-head">In this tab</h2>
          <ul class="members">
            <li v-for="m in members" :key="m.address" class="member">
              <Avatar :name="m.displayName" :seed="m.avatarSeed" />
              <div class="member-body">
                <p class="member-name">{{ m.displayName }}<span v-if="m.address === session.address" class="tiny muted"> · you</span></p>
                <p class="tiny muted mono">{{ shortAddress(m.address) }}</p>
              </div>
            </li>
          </ul>
          <button class="btn btn--ghost btn--block" type="button" @click="inviteOpen = true">
            Invite someone
          </button>
        </section>
      </template>
    </div>

    <AddExpenseSheet
      v-if="detail"
      :open="addOpen"
      :tab-id="detail.tab.id"
      :members="members"
      @close="addOpen = false"
      @added="onExpenseAdded"
    />

    <Sheet :open="inviteOpen" title="Invite to this tab" @close="inviteOpen = false">
      <div v-if="detail" class="stack invite">
        <p class="small muted">
          Anyone with this code can join the tab and see everything on it. Share it with the people
          you're splitting with, not the internet.
        </p>

        <div class="code-display">
          <span class="mono">{{ detail.tab.inviteCode }}</span>
        </div>

        <button class="btn btn--primary btn--block" type="button" @click="share">
          Share invite link
        </button>
        <button class="btn btn--ghost btn--block" type="button" @click="copy(detail.tab.inviteCode)">
          {{ copied ? 'Copied' : 'Copy code' }}
        </button>

        <p class="tiny muted">
          The link opens Loop inside Nimiq Pay and drops them straight into this tab. If it doesn't
          open, they can enter the code by hand on the Tabs screen.
        </p>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: calc(env(safe-area-inset-top) + 16px);
  margin-bottom: 18px;
}

.back {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: var(--tap);
  height: var(--tap);
  margin-left: -10px;
  border-radius: 50%;
  color: var(--ink-70);
}

.head .back:last-child {
  margin-left: 0;
  margin-right: -10px;
}

.back:active {
  background: var(--ink-06);
}

.head-text {
  flex: 1 1 auto;
  min-width: 0;
}

.head-title {
  font-size: 22px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-skeleton {
  height: 24px;
  width: 60%;
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

.balances {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settled {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
}

.settled-mark {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(33, 188, 165, 0.14);
  color: var(--nq-green);
  font-weight: 900;
}

.debt-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.debt {
  display: flex;
  align-items: center;
  gap: 10px;
}

.debt-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.debt--other {
  opacity: 0.7;
}

.owe-amount :deep(.amount-main) {
  color: var(--owe);
}

.owed-amount :deep(.amount-main) {
  color: var(--owed);
}

.rebalance-note {
  line-height: 1.5;
}

.section {
  margin-top: 28px;
}

.section-head {
  margin-bottom: 12px;
}

.entries,
.members {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.entry,
.member {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.entry:first-child,
.member:first-child {
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.entry:last-child,
.member:last-child {
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.entry:only-child,
.member:only-child {
  border-radius: var(--radius-lg);
}

.entry-body,
.member-body {
  flex: 1 1 auto;
  min-width: 0;
}

.entry-what,
.member-name {
  font-weight: 700;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-right {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0;
}

.entry-remove {
  /* Small text, full-size target: the hit area is padded out to 44px and the
     negative margins keep the row from growing to match. */
  min-height: var(--tap);
  display: flex;
  align-items: center;
  padding: 0 8px;
  margin: -8px -8px -8px 0;
  color: var(--ink-30);
  font-weight: 700;
}

.entry-remove:active {
  color: var(--nq-red);
}

.paid-mark {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(33, 188, 165, 0.14);
  color: var(--nq-green);
}

.members + .btn {
  margin-top: 12px;
}

.empty {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 20px;
}

.empty-mark {
  font-size: 34px;
}

.empty p {
  max-width: 32ch;
  line-height: 1.5;
}

.invite {
  padding-bottom: 8px;
}

.code-display {
  padding: 20px;
  border-radius: var(--radius-lg);
  background: var(--surface-sunken);
  text-align: center;
}

.code-display span {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0.18em;
}
</style>
