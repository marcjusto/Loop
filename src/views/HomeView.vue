<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Avatar from '../components/Avatar.vue'
import NimAmount from '../components/NimAmount.vue'
import Sheet from '../components/Sheet.vue'
import { ApiError, api } from '../lib/api.js'
import { formatNim, pluralize, relativeTime } from '../lib/format.js'
import {
  activeTabId,
  plan,
  refreshAll,
  screen,
  session,
  showToast,
  tabs,
} from '../lib/store.js'

const loading = ref(true)
const creating = ref(false)
const joining = ref(false)
const newTabOpen = ref(false)
const joinOpen = ref(false)

const newName = ref('')
const newEmoji = ref('🧾')
const joinCode = ref('')
const formError = ref<string | null>(null)

const EMOJI = ['🧾', '🏠', '✈️', '🍜', '🎬', '🚗', '🏔️', '🎁', '⚽️', '☕️', '🛒', '🎉']

const netTotal = computed(() => {
  const p = plan.value
  if (!p) return 0
  const owe = p.youOwe.reduce((sum, d) => sum + d.amountLuna, 0)
  const owed = p.owedToYou.reduce((sum, d) => sum + d.amountLuna, 0)
  return owed - owe
})

const activeTabs = computed(() => tabs.value.filter((t) => !t.archived))

const savedCount = computed(() => {
  const p = plan.value
  if (!p) return 0
  return Math.max(0, p.rawPaymentCount - p.debts.length)
})

onMounted(async () => {
  try {
    await refreshAll()
  } finally {
    loading.value = false
  }
})

function openTab(id: string) {
  activeTabId.value = id
  screen.value = 'tab'
}

async function createTab() {
  const name = newName.value.trim()
  if (!name) {
    formError.value = 'Give the tab a name — “Lisbon trip”, “Flat 3B”, anything.'
    return
  }
  creating.value = true
  formError.value = null
  try {
    const result = await api.createTab(name, newEmoji.value)
    await refreshAll()
    newTabOpen.value = false
    newName.value = ''
    newEmoji.value = '🧾'
    activeTabId.value = result.id
    screen.value = 'tab'
    showToast(`${result.name} is open. Share the code to add people.`, 'good')
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Could not create that tab.'
  } finally {
    creating.value = false
  }
}

async function joinTab() {
  const code = joinCode.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!code) {
    formError.value = 'Enter the code someone shared with you.'
    return
  }
  joining.value = true
  formError.value = null
  try {
    const result = await api.joinTab(code)
    await refreshAll()
    joinOpen.value = false
    joinCode.value = ''
    activeTabId.value = result.id
    screen.value = 'tab'
    showToast(result.alreadyMember ? `You're already in ${result.name}` : `Joined ${result.name}`, 'good')
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'That code did not work.'
  } finally {
    joining.value = false
  }
}

function openNewTab() {
  formError.value = null
  newTabOpen.value = true
}

function openJoin() {
  formError.value = null
  joinOpen.value = true
}
</script>

<template>
  <div class="screen">
    <div class="wrap">
      <header class="head">
        <div>
          <p class="label">Your position</p>
          <h1 class="head-title">
            {{ netTotal === 0 ? "You're all square" : netTotal > 0 ? "You're owed" : 'You owe' }}
          </h1>
        </div>
        <Avatar :name="session.displayName" :seed="session.avatarSeed" size="lg" />
      </header>

      <button
        v-if="netTotal !== 0"
        type="button"
        class="balance"
        :class="netTotal > 0 ? 'balance--up' : 'balance--down'"
        @click="screen = 'settle'"
      >
        <NimAmount :luna="Math.abs(netTotal)" size="xl" fiat />
        <span class="balance-go">
          {{ netTotal > 0 ? 'See who owes you' : 'Settle up' }}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </button>

      <div v-else-if="!loading && activeTabs.length > 0" class="square card">
        <span class="square-mark" aria-hidden="true">✓</span>
        <div>
          <strong>Nothing outstanding</strong>
          <p class="small muted">Every tab you're in is settled.</p>
        </div>
      </div>

      <p v-if="savedCount > 0" class="saved small">
        Loop turned <strong>{{ plan?.rawPaymentCount }}</strong>
        {{ pluralize(plan?.rawPaymentCount ?? 0, 'obligation') }} into
        <strong>{{ plan?.debts.length }}</strong>
        {{ pluralize(plan?.debts.length ?? 0, 'payment') }}.
        <template v-if="(plan?.cancelledLuna ?? 0) > 0">
          <span class="saved-ring">
            {{ formatNim(plan?.cancelledLuna ?? 0) }} NIM cancelled outright.
          </span>
        </template>
      </p>

      <section class="section">
        <div class="row row--between section-head">
          <h2>Tabs</h2>
          <div class="row">
            <button class="btn btn--ghost btn--sm" type="button" @click="openJoin">Join</button>
            <button class="btn btn--primary btn--sm" type="button" @click="openNewTab">New tab</button>
          </div>
        </div>

        <div v-if="loading" class="stack">
          <div v-for="i in 3" :key="i" class="skeleton tab-skeleton" />
        </div>

        <div v-else-if="activeTabs.length === 0" class="empty card">
          <span class="empty-mark" aria-hidden="true">🧾</span>
          <h3>No tabs yet</h3>
          <p class="small muted">
            A tab is a shared running total — a trip, a flat, a group dinner. Start one and share the
            code, or join one somebody sent you.
          </p>
          <div class="empty-actions">
            <button class="btn btn--primary" type="button" @click="openNewTab">Start a tab</button>
            <button class="btn btn--ghost" type="button" @click="openJoin">Use a code</button>
          </div>
        </div>

        <ul v-else class="tab-list">
          <li v-for="tab in activeTabs" :key="tab.id">
            <button type="button" class="tab-card" @click="openTab(tab.id)">
              <span class="tab-emoji" aria-hidden="true">{{ tab.emoji }}</span>
              <span class="tab-body">
                <span class="tab-name">{{ tab.name }}</span>
                <span class="tab-meta tiny muted">
                  {{ tab.memberCount }} {{ pluralize(tab.memberCount, 'person', 'people') }}
                  · {{ tab.expenseCount }} {{ pluralize(tab.expenseCount, 'entry', 'entries') }}
                  · {{ relativeTime(tab.lastActivity) }}
                </span>
              </span>
              <span class="tab-net" :class="tab.yourNetLuna > 0 ? 'owed' : tab.yourNetLuna < 0 ? 'owe' : 'muted'">
                <template v-if="tab.yourNetLuna === 0">
                  <span class="tiny">settled</span>
                </template>
                <NimAmount v-else :luna="tab.yourNetLuna" size="sm" sign />
              </span>
            </button>
          </li>
        </ul>
      </section>
    </div>

    <Sheet :open="newTabOpen" title="New tab" @close="newTabOpen = false">
      <div class="stack">
        <div class="field">
          <label class="label" for="tab-name">What's it for?</label>
          <input
            id="tab-name"
            v-model="newName"
            type="text"
            placeholder="Lisbon trip"
            maxlength="60"
            autocomplete="off"
            enterkeyhint="done"
            @keyup.enter="createTab"
          />
        </div>

        <div class="field">
          <span class="label">Pick an icon</span>
          <div class="emoji-grid">
            <button
              v-for="e in EMOJI"
              :key="e"
              type="button"
              class="emoji-btn"
              :class="{ 'is-on': newEmoji === e }"
              :aria-pressed="newEmoji === e"
              @click="newEmoji = e"
            >
              {{ e }}
            </button>
          </div>
        </div>

        <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>

        <button class="btn btn--primary btn--block" type="button" :disabled="creating" @click="createTab">
          {{ creating ? 'Creating…' : 'Create tab' }}
        </button>
      </div>
    </Sheet>

    <Sheet :open="joinOpen" title="Join a tab" @close="joinOpen = false">
      <div class="stack">
        <p class="small muted">
          Whoever started the tab can find the code on its page. Six characters, no vowels.
        </p>
        <div class="field">
          <label class="label" for="join-code">Invite code</label>
          <input
            id="join-code"
            v-model="joinCode"
            type="text"
            class="mono code-input"
            placeholder="K7QM3B"
            maxlength="8"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            enterkeyhint="go"
            @keyup.enter="joinTab"
          />
        </div>
        <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>
        <button class="btn btn--primary btn--block" type="button" :disabled="joining" @click="joinTab">
          {{ joining ? 'Joining…' : 'Join tab' }}
        </button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-top: calc(env(safe-area-inset-top) + 20px);
  margin-bottom: 16px;
}

.head-title {
  margin-top: 2px;
  font-size: 26px;
}

.balance {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 20px;
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow);
  text-align: left;
  transition: transform 0.12s ease;
}

.balance:active {
  transform: scale(0.99);
}

.balance--down :deep(.amount-main) {
  color: var(--owe);
}

.balance--up :deep(.amount-main) {
  color: var(--owed);
}

.balance :deep(.amount) {
  align-items: flex-start;
}

.balance-go {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 800;
  color: var(--nq-light-blue);
}

.square {
  display: flex;
  align-items: center;
  gap: 14px;
}

.square-mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: rgba(33, 188, 165, 0.14);
  color: var(--nq-green);
  font-weight: 900;
}

.saved {
  margin-top: 12px;
  color: var(--ink-70);
  line-height: 1.5;
}

.saved strong {
  color: var(--ink);
}

.saved-ring {
  color: var(--nq-green);
  font-weight: 700;
}

.section {
  margin-top: 28px;
}

.section-head {
  margin-bottom: 12px;
}

.tab-skeleton {
  height: 68px;
  border-radius: var(--radius-lg);
}

.tab-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tab-card {
  width: 100%;
  min-height: 68px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  text-align: left;
  transition: transform 0.12s ease;
}

.tab-card:active {
  transform: scale(0.99);
}

.tab-emoji {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: var(--radius);
  background: var(--surface-sunken);
  font-size: 20px;
}

.tab-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tab-name {
  font-weight: 800;
  font-size: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-net {
  flex: 0 0 auto;
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
  font-size: 36px;
}

.empty p {
  max-width: 34ch;
  line-height: 1.5;
}

.empty-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(46px, 1fr));
  gap: 8px;
}

.emoji-btn {
  min-height: var(--tap);
  border-radius: var(--radius);
  background: var(--surface-sunken);
  font-size: 20px;
  border: 2px solid transparent;
  transition: border-color 0.12s ease;
}

.emoji-btn.is-on {
  border-color: var(--nq-light-blue);
  background: rgba(5, 130, 202, 0.08);
}

.code-input {
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 22px;
  font-weight: 700;
  text-align: center;
}
</style>
