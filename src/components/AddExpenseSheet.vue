<script setup lang="ts">
/**
 * Adding an expense.
 *
 * The whole flow has to survive being done one-handed, in a restaurant, by
 * somebody who has had a drink. So: amount first, big keypad-friendly field,
 * everything else already filled in with the answer that is right most of the
 * time (you paid, split evenly, everyone included).
 *
 * The exact-amounts mode refuses to submit until the parts add up, and says
 * how far off they are, because a money app that quietly rounds is worse than
 * one that nags.
 */
import { computed, ref, watch } from 'vue'
import Avatar from '../components/Avatar.vue'
import Sheet from '../components/Sheet.vue'
import { api, ApiError, type Member } from '../lib/api.js'
import {
  fiatToLuna,
  formatFiat,
  formatNim,
  lunaToFiat,
  parseNimInput,
  LUNA_PER_NIM,
} from '../lib/format.js'
import { splitByShares, splitEqually } from '../../shared/netting.js'
import { nimPrice, session, showToast } from '../lib/store.js'

const props = defineProps<{
  open: boolean
  tabId: string
  members: Member[]
}>()
const emit = defineEmits<{ close: []; added: [] }>()

type Mode = 'equal' | 'exact' | 'shares'

const amountText = ref('')
const currencyMode = ref<'nim' | 'fiat'>('nim')
const description = ref('')
const payer = ref(session.address ?? '')
const mode = ref<Mode>('equal')
const included = ref<string[]>([])
const exactText = ref<Record<string, string>>({})
const weights = ref<Record<string, number>>({})
const saving = ref(false)
const error = ref<string | null>(null)

const rate = computed(() => nimPrice.value.rate)
const canUseFiat = computed(() => rate.value !== null && rate.value > 0)

/** The amount in luna, whichever unit the user typed it in. */
const amountLuna = computed<number | null>(() => {
  const raw = amountText.value.trim()
  if (!raw) return null
  if (currencyMode.value === 'fiat' && rate.value) {
    const value = Number(raw.replace(/[\s,]/g, ''))
    if (!Number.isFinite(value) || value <= 0) return null
    return fiatToLuna(value, rate.value)
  }
  return parseNimInput(raw)
})

const amountHint = computed(() => {
  const luna = amountLuna.value
  if (luna === null) return null
  if (currencyMode.value === 'fiat') return `${formatNim(luna)} NIM`
  if (rate.value) return `≈ ${formatFiat(lunaToFiat(luna, rate.value), nimPrice.value.currency)}`
  return null
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    // Fresh every time it opens — a stale half-typed expense is a hazard.
    amountText.value = ''
    description.value = ''
    payer.value = session.address ?? props.members[0]?.address ?? ''
    mode.value = 'equal'
    included.value = props.members.map((m) => m.address)
    exactText.value = {}
    weights.value = Object.fromEntries(props.members.map((m) => [m.address, 1]))
    error.value = null
    currencyMode.value = 'nim'
  },
)

function toggleMember(address: string) {
  const set = new Set(included.value)
  if (set.has(address)) set.delete(address)
  else set.add(address)
  included.value = [...set]
}

/** Live preview of what each person ends up owing. */
const preview = computed<Array<{ address: string; shareLuna: number }>>(() => {
  const total = amountLuna.value
  if (!total) return []
  const people = included.value.filter((a) => props.members.some((m) => m.address === a))
  if (people.length === 0) return []

  if (mode.value === 'exact') {
    return people.map((address) => ({
      address,
      shareLuna: parseNimInput(exactText.value[address] ?? '') ?? 0,
    }))
  }
  if (mode.value === 'shares') {
    const parts = splitByShares(
      total,
      people.map((a) => weights.value[a] ?? 1),
    )
    return people.map((address, i) => ({ address, shareLuna: parts[i] }))
  }
  const parts = splitEqually(total, people.length)
  return people.map((address, i) => ({ address, shareLuna: parts[i] }))
})

const exactTotal = computed(() => preview.value.reduce((sum, p) => sum + p.shareLuna, 0))

const exactGap = computed(() => {
  if (mode.value !== 'exact') return 0
  const total = amountLuna.value ?? 0
  return total - exactTotal.value
})

const canSubmit = computed(() => {
  if (saving.value) return false
  if (!amountLuna.value) return false
  if (included.value.length === 0) return false
  if (!payer.value) return false
  if (mode.value === 'exact' && exactGap.value !== 0) return false
  return true
})

function nameOf(address: string): string {
  if (address === session.address) return 'You'
  return props.members.find((m) => m.address === address)?.displayName ?? address.slice(-4)
}

async function submit() {
  const total = amountLuna.value
  if (!total) {
    error.value = 'Enter an amount.'
    return
  }
  if (included.value.length === 0) {
    error.value = 'Pick at least one person to split this with.'
    return
  }
  if (mode.value === 'exact' && exactGap.value !== 0) {
    const off = Math.abs(exactGap.value)
    error.value =
      exactGap.value > 0
        ? `You still have ${formatNim(off)} NIM to assign.`
        : `That's ${formatNim(off)} NIM more than the total.`
    return
  }

  saving.value = true
  error.value = null
  try {
    await api.addExpense(props.tabId, {
      amountLuna: total,
      description: description.value.trim() || 'Expense',
      payer: payer.value,
      splitMode: mode.value,
      participants: included.value,
      shares:
        mode.value === 'exact'
          ? preview.value.map((p) => ({ address: p.address, shareLuna: p.shareLuna }))
          : mode.value === 'shares'
            ? included.value.map((a) => ({ address: a, weight: weights.value[a] ?? 1 }))
            : undefined,
      fiatCurrency: currencyMode.value === 'fiat' ? nimPrice.value.currency : null,
      fiatAmount:
        currencyMode.value === 'fiat' ? Number(amountText.value.replace(/[\s,]/g, '')) : null,
      fiatRate: currencyMode.value === 'fiat' ? rate.value : null,
    })
    showToast('Added to the tab', 'good')
    emit('added')
    emit('close')
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save that. Try again.'
  } finally {
    saving.value = false
  }
}

function bumpWeight(address: string, by: number) {
  const next = Math.max(0, (weights.value[address] ?? 1) + by)
  weights.value = { ...weights.value, [address]: next }
}

function fillRemainder(address: string) {
  const gap = exactGap.value
  if (gap <= 0) return
  const current = parseNimInput(exactText.value[address] ?? '') ?? 0
  exactText.value = {
    ...exactText.value,
    [address]: String((current + gap) / LUNA_PER_NIM),
  }
}
</script>

<template>
  <Sheet :open="open" title="Add an expense" @close="emit('close')">
    <div class="stack">
      <div class="amount-block">
        <div class="amount-row">
          <input
            v-model="amountText"
            class="amount-input mono"
            type="text"
            inputmode="decimal"
            placeholder="0"
            autocomplete="off"
            aria-label="Amount"
          />
          <button
            v-if="canUseFiat"
            type="button"
            class="unit-toggle"
            @click="currencyMode = currencyMode === 'nim' ? 'fiat' : 'nim'"
          >
            {{ currencyMode === 'nim' ? 'NIM' : nimPrice.currency.toUpperCase() }}
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 10l5-5 5 5M7 14l5 5 5-5" />
            </svg>
          </button>
          <span v-else class="unit-static">NIM</span>
        </div>
        <p v-if="amountHint" class="amount-hint tiny muted mono">{{ amountHint }}</p>
      </div>

      <div class="field">
        <label class="label" for="expense-what">What was it?</label>
        <input
          id="expense-what"
          v-model="description"
          type="text"
          placeholder="Dinner at Taberna"
          maxlength="120"
          autocomplete="off"
        />
      </div>

      <div class="field">
        <span class="label">Who paid?</span>
        <div class="chips">
          <button
            v-for="m in members"
            :key="m.address"
            type="button"
            class="chip"
            :class="{ 'is-on': payer === m.address }"
            :aria-pressed="payer === m.address"
            @click="payer = m.address"
          >
            <Avatar :name="m.displayName" :seed="m.avatarSeed" size="sm" />
            {{ nameOf(m.address) }}
          </button>
        </div>
      </div>

      <div class="field">
        <span class="label">Split how?</span>
        <div class="segmented" role="group" aria-label="Split mode">
          <button
            v-for="option in (['equal', 'exact', 'shares'] as Mode[])"
            :key="option"
            type="button"
            class="seg"
            :class="{ 'is-on': mode === option }"
            :aria-pressed="mode === option"
            @click="mode = option"
          >
            {{ option === 'equal' ? 'Evenly' : option === 'exact' ? 'Exact' : 'Shares' }}
          </button>
        </div>
      </div>

      <div class="field">
        <span class="label">Split between</span>
        <ul class="people">
          <li v-for="m in members" :key="m.address" class="person">
            <button
              type="button"
              class="person-toggle"
              :aria-pressed="included.includes(m.address)"
              @click="toggleMember(m.address)"
            >
              <span class="check" :class="{ 'is-on': included.includes(m.address) }" aria-hidden="true">
                <svg v-if="included.includes(m.address)" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 12l6 6L20 6" />
                </svg>
              </span>
              <Avatar :name="m.displayName" :seed="m.avatarSeed" size="sm" />
              <span class="person-name">{{ nameOf(m.address) }}</span>
            </button>

            <template v-if="included.includes(m.address)">
              <div v-if="mode === 'exact'" class="person-input">
                <input
                  v-model="exactText[m.address]"
                  class="mono"
                  type="text"
                  inputmode="decimal"
                  placeholder="0"
                  :aria-label="`Amount for ${nameOf(m.address)}`"
                />
                <button
                  v-if="exactGap > 0"
                  type="button"
                  class="fill-btn tiny"
                  @click="fillRemainder(m.address)"
                >
                  +rest
                </button>
              </div>

              <div v-else-if="mode === 'shares'" class="stepper">
                <button type="button" aria-label="Fewer shares" @click="bumpWeight(m.address, -1)">−</button>
                <span class="mono">{{ weights[m.address] ?? 1 }}</span>
                <button type="button" aria-label="More shares" @click="bumpWeight(m.address, 1)">+</button>
              </div>

              <span v-else class="person-share mono tiny muted">
                {{ formatNim(preview.find((p) => p.address === m.address)?.shareLuna ?? 0) }}
              </span>
            </template>
          </li>
        </ul>
      </div>

      <p v-if="mode === 'exact' && amountLuna && exactGap !== 0" class="gap" :class="exactGap > 0 ? 'gap--under' : 'gap--over'">
        {{
          exactGap > 0
            ? `${formatNim(exactGap)} NIM left to assign`
            : `${formatNim(-exactGap)} NIM over the total`
        }}
      </p>

      <p v-if="error" class="field-error" role="alert">{{ error }}</p>

      <button class="btn btn--primary btn--block" type="button" :disabled="!canSubmit" @click="submit">
        {{ saving ? 'Saving…' : 'Add to tab' }}
      </button>
    </div>
  </Sheet>
</template>

<style scoped>
.amount-block {
  padding: 8px 0 4px;
  border-bottom: 2px solid var(--ink-06);
}

.amount-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.amount-input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  background: none;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: -0.03em;
  padding: 0;
  outline: none;
}

.amount-input::placeholder {
  color: var(--ink-12);
}

.unit-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: var(--tap);
  padding: 0 12px;
  border-radius: 999px;
  background: var(--ink-06);
  font-size: 13px;
  font-weight: 800;
  color: var(--ink-70);
  flex: 0 0 auto;
}

.unit-static {
  font-size: 15px;
  font-weight: 800;
  color: var(--ink-30);
}

.amount-hint {
  margin-top: 2px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: var(--tap);
  padding: 0 14px 0 6px;
  border-radius: 999px;
  background: var(--surface-sunken);
  border: 2px solid transparent;
  font-size: 14px;
  font-weight: 700;
}

.chip.is-on {
  border-color: var(--nq-light-blue);
  background: rgba(5, 130, 202, 0.08);
}

.segmented {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--surface-sunken);
}

.seg {
  flex: 1 1 0;
  min-height: var(--tap);
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink-50);
  transition: background 0.15s ease, color 0.15s ease;
}

.seg.is-on {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-sm);
}

.people {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.person {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--tap);
  padding: 4px 0;
  border-bottom: 1px solid var(--ink-06);
}

.person:last-child {
  border-bottom: none;
}

.person-toggle {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--tap);
  text-align: left;
}

.check {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 2px solid var(--ink-12);
  color: #fff;
}

.check.is-on {
  background: var(--nq-light-blue);
  border-color: var(--nq-light-blue);
}

.person-name {
  font-weight: 700;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.person-input {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.person-input input {
  width: 92px;
  min-height: var(--tap);
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  border: 2px solid var(--ink-12);
  text-align: right;
  font-size: 15px;
  background: var(--surface);
}

.person-input input:focus {
  outline: none;
  border-color: var(--nq-light-blue);
}

.fill-btn {
  min-height: var(--tap);
  padding: 0 8px;
  border-radius: var(--radius-sm);
  background: var(--ink-06);
  font-weight: 700;
  color: var(--ink-70);
}

.stepper {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.stepper button {
  width: var(--tap);
  height: var(--tap);
  border-radius: 50%;
  background: var(--ink-06);
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
}

.stepper span {
  min-width: 28px;
  text-align: center;
  font-weight: 800;
}

.person-share {
  flex: 0 0 auto;
}

.gap {
  font-size: 13px;
  font-weight: 700;
  text-align: center;
}

.gap--under {
  color: var(--nq-orange);
}

.gap--over {
  color: var(--nq-red);
}
</style>
