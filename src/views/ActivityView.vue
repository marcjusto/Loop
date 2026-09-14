<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Avatar from '../components/Avatar.vue'
import NimAmount from '../components/NimAmount.vue'
import { api, ApiError, type ActivityResponse } from '../lib/api.js'
import { nameFor, relativeTime } from '../lib/format.js'
import { activeTabId, screen, session } from '../lib/store.js'

const data = ref<ActivityResponse | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

type Item =
  | { kind: 'expense'; at: number; id: string; tabId: string; tabName: string; emoji: string; payer: string; amountLuna: number; description: string }
  | { kind: 'settlement'; at: number; id: string; fromAddr: string; toAddr: string; amountLuna: number; blockHeight: number | null }

const feed = computed<Item[]>(() => {
  if (!data.value) return []
  const items: Item[] = [
    ...data.value.expenses.map((e) => ({ kind: 'expense' as const, at: e.createdAt, ...e })),
    ...data.value.settlements.map((s) => ({
      kind: 'settlement' as const,
      at: s.createdAt,
      id: s.id,
      fromAddr: s.fromAddr,
      toAddr: s.toAddr,
      amountLuna: s.amountLuna,
      blockHeight: s.blockHeight,
    })),
  ]
  return items.sort((a, b) => b.at - a.at).slice(0, 60)
})

onMounted(async () => {
  try {
    data.value = await api.activity()
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Could not load your activity.'
  } finally {
    loading.value = false
  }
})

function name(address: string): string {
  return nameFor(address, data.value?.members ?? [], session.address ?? undefined)
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function seed(address: string): number {
  return data.value?.members.find((m) => m.address === address)?.avatarSeed ?? 0
}

function openTab(id: string) {
  activeTabId.value = id
  screen.value = 'tab'
}
</script>

<template>
  <div class="screen">
    <div class="wrap">
      <header class="head">
        <h1>Activity</h1>
        <p class="muted small">Everything across every tab you're in.</p>
      </header>

      <p v-if="loadError" class="error card" role="alert">{{ loadError }}</p>

      <div v-else-if="loading" class="stack">
        <div v-for="i in 5" :key="i" class="skeleton row-skeleton" />
      </div>

      <div v-else-if="feed.length === 0" class="empty card">
        <span class="empty-mark" aria-hidden="true">📭</span>
        <h3>Nothing has happened yet</h3>
        <p class="small muted">Once people start adding things to your tabs, it shows up here.</p>
      </div>

      <ul v-else class="feed">
        <li v-for="item in feed" :key="`${item.kind}-${item.id}`" class="item">
          <template v-if="item.kind === 'expense'">
            <Avatar :name="name(item.payer)" :seed="seed(item.payer)" />
            <button class="item-body" type="button" @click="openTab(item.tabId)">
              <p class="item-title">{{ item.description }}</p>
              <p class="item-meta tiny muted">
                {{ cap(name(item.payer)) }} paid
                · <span aria-hidden="true">{{ item.emoji }}</span> {{ item.tabName }}
                · {{ relativeTime(item.at) }}
              </p>
            </button>
            <NimAmount :luna="item.amountLuna" size="sm" />
          </template>

          <template v-else>
            <span class="paid-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 12l6 6L20 6" />
              </svg>
            </span>
            <div class="item-body item-body--static">
              <p class="item-title">
                {{ cap(name(item.fromAddr)) }} paid {{ name(item.toAddr) }}
              </p>
              <p class="item-meta tiny muted">
                Settled in NIM · {{ relativeTime(item.at) }}
                <template v-if="item.blockHeight"> · block {{ item.blockHeight.toLocaleString() }}</template>
              </p>
            </div>
            <NimAmount :luna="item.amountLuna" size="sm" class="settled-amount" />
          </template>
        </li>
      </ul>
    </div>
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

.row-skeleton {
  height: 60px;
  border-radius: var(--radius);
}

.error {
  color: var(--nq-red);
}

.feed {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.item:first-child {
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.item:last-child {
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.item:only-child {
  border-radius: var(--radius-lg);
}

.item-body {
  flex: 1 1 auto;
  min-width: 0;
  text-align: left;
  min-height: var(--tap);
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.item-body--static {
  cursor: default;
}

.item-title {
  font-weight: 700;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.settled-amount :deep(.amount-main) {
  color: var(--nq-green);
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
  font-size: 34px;
}

.empty p {
  max-width: 30ch;
  line-height: 1.5;
}
</style>
