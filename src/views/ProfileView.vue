<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Avatar from '../components/Avatar.vue'
import { api, ApiError } from '../lib/api.js'
import { formatNim, prettyAddress } from '../lib/format.js'
import { providerState } from '../lib/nimiq.js'
import { language, nimPrice, refreshPrice, session, showToast, signOut, stats } from '../lib/store.js'

const nameDraft = ref(session.displayName)
const savingName = ref(false)
const nameError = ref<string | null>(null)

const dirty = computed(() => nameDraft.value.trim() !== session.displayName && nameDraft.value.trim().length > 0)

onMounted(async () => {
  nameDraft.value = session.displayName
  try {
    stats.value = await api.stats()
  } catch {
    // The counter is decoration. Its absence changes nothing.
  }
})

async function saveName() {
  const name = nameDraft.value.trim()
  if (!name) {
    nameError.value = 'Pick a name people will recognise.'
    return
  }
  savingName.value = true
  nameError.value = null
  try {
    await api.updateName(name)
    session.displayName = name
    showToast('Name updated', 'good')
  } catch (err) {
    nameError.value = err instanceof ApiError ? err.message : 'Could not save that.'
  } finally {
    savingName.value = false
  }
}

async function copyAddress() {
  if (!session.address) return
  try {
    await navigator.clipboard.writeText(prettyAddress(session.address))
    showToast('Address copied', 'good')
  } catch {
    showToast('Could not copy — long-press to select it.', 'bad')
  }
}

const currencies = ['usd', 'eur', 'gbp', 'brl', 'ars', 'ngn', 'inr', 'jpy']

async function setCurrency(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  nimPrice.value = { ...nimPrice.value, currency: value, rate: null }
  await refreshPrice()
}
</script>

<template>
  <div class="screen">
    <div class="wrap">
      <header class="head">
        <Avatar :name="session.displayName" :seed="session.avatarSeed" size="lg" />
        <div>
          <h1>{{ session.displayName }}</h1>
          <button class="address mono tiny muted" type="button" @click="copyAddress">
            {{ session.address ? prettyAddress(session.address) : '' }}
          </button>
        </div>
      </header>

      <section class="card stack">
        <div class="field">
          <label class="label" for="display-name">Your name in tabs</label>
          <input
            id="display-name"
            v-model="nameDraft"
            type="text"
            maxlength="40"
            placeholder="What friends call you"
            autocomplete="name"
          />
        </div>
        <p v-if="nameError" class="field-error" role="alert">{{ nameError }}</p>
        <button class="btn btn--primary btn--block" type="button" :disabled="!dirty || savingName" @click="saveName">
          {{ savingName ? 'Saving…' : 'Save name' }}
        </button>
      </section>

      <section class="card stack">
        <div class="field">
          <label class="label" for="currency">Show amounts also in</label>
          <select id="currency" :value="nimPrice.currency" @change="setCurrency">
            <option v-for="c in currencies" :key="c" :value="c">{{ c.toUpperCase() }}</option>
          </select>
        </div>
        <p class="tiny muted">
          NIM is what people actually owe each other. The second figure is an estimate at the
          current rate<template v-if="nimPrice.stale">, which we could not refresh just now</template>.
        </p>
      </section>

      <section v-if="stats" class="card stats">
        <p class="label">Loop so far</p>
        <dl>
          <div>
            <dt class="tiny muted">People</dt>
            <dd class="mono">{{ stats.users.toLocaleString() }}</dd>
          </div>
          <div>
            <dt class="tiny muted">Tabs</dt>
            <dd class="mono">{{ stats.tabs.toLocaleString() }}</dd>
          </div>
          <div>
            <dt class="tiny muted">Tracked</dt>
            <dd class="mono">{{ formatNim(stats.trackedLuna) }}</dd>
          </div>
          <div>
            <dt class="tiny muted">Settled in NIM</dt>
            <dd class="mono">{{ formatNim(stats.settledLuna) }}</dd>
          </div>
          <div>
            <dt class="tiny muted">Rings cancelled</dt>
            <dd class="mono">{{ stats.rings.toLocaleString() }}</dd>
          </div>
          <div>
            <dt class="tiny muted">Debt erased</dt>
            <dd class="mono erased">{{ formatNim(stats.cancelledLuna) }}</dd>
          </div>
        </dl>
      </section>

      <section class="card about">
        <p class="label">About</p>
        <p class="small">
          Loop is a mini app for Nimiq Pay. Your identity here is your Nimiq address — you signed a
          message to prove you hold it. Loop has no access to your keys and cannot move funds; every
          payment goes through Nimiq Pay's own approval dialog.
        </p>
        <dl class="meta">
          <div>
            <dt class="tiny muted">Wallet</dt>
            <dd class="tiny">
              {{
                providerState === 'ready'
                  ? 'Connected to Nimiq Pay'
                  : providerState === 'connecting'
                    ? 'Connecting…'
                    : 'Not running inside Nimiq Pay'
              }}
            </dd>
          </div>
          <div>
            <dt class="tiny muted">Language</dt>
            <dd class="tiny">{{ language }}</dd>
          </div>
        </dl>
      </section>

      <button class="btn btn--danger btn--block signout" type="button" @click="signOut">Sign out</button>
    </div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-top: calc(env(safe-area-inset-top) + 20px);
  margin-bottom: 20px;
}

.head h1 {
  font-size: 24px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.address {
  text-align: left;
  padding: 0;
  word-break: break-all;
  line-height: 1.4;
}

.card {
  margin-bottom: 14px;
}

.stats dl {
  margin: 10px 0 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 14px;
}

.stats dd {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}

.erased {
  color: var(--nq-green);
}

.about p {
  margin-top: 8px;
  line-height: 1.55;
  color: var(--ink-70);
}

.meta {
  margin: 14px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}

.meta dd {
  margin: 0;
  font-weight: 700;
}

.signout {
  margin-top: 6px;
}
</style>
