<script setup lang="ts">
/**
 * The first sixty seconds.
 *
 * A judge, or a friend who just got sent a link, has to understand what this
 * is before they tap anything. So: the idea in one sentence, the idea as a
 * picture, then one button.
 */
import { computed } from 'vue'
import LoopRing from '../components/LoopRing.vue'
import { providerState } from '../lib/nimiq.js'
import { formatNim } from '../lib/format.js'
import { globalError, pendingInviteCode, signIn, signingIn, stats } from '../lib/store.js'

const demoMembers = ['NQ_DEMO_YOU', 'NQ_DEMO_BEA', 'NQ_DEMO_CAL']
const demoDirectory = [
  { address: 'NQ_DEMO_YOU', displayName: 'You', avatarSeed: 0 },
  { address: 'NQ_DEMO_BEA', displayName: 'Bea', avatarSeed: 1 },
  { address: 'NQ_DEMO_CAL', displayName: 'Cal', avatarSeed: 2 },
]

const outside = computed(() => providerState.value === 'unavailable')
const checking = computed(() => providerState.value === 'connecting')

const erased = computed(() => {
  const luna = stats.value?.cancelledLuna ?? 0
  return luna > 0 ? formatNim(luna) : null
})
</script>

<template>
  <div class="screen screen--plain welcome">
    <div class="wrap">
      <header class="hero">
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <path
              d="M16 3.2 27 9.6v12.8L16 28.8 5 22.4V9.6z"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linejoin="round"
            />
            <path
              d="M11.5 16a4.5 4.5 0 1 1 9 0 4.5 4.5 0 1 1-9 0"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <h1>Loop</h1>
        <p class="tagline">Shared tabs that settle themselves.</p>
      </header>

      <section class="pitch card">
        <p class="pitch-lead">
          Split costs with the people you actually live, travel and eat with. Loop keeps the running
          total, cancels the debts that cancel each other, and settles whatever is left in one tap
          with NIM.
        </p>
      </section>

      <section class="demo card">
        <p class="label">What makes it different</p>
        <h2 class="demo-title">Some debts don't need paying at all</h2>
        <LoopRing :members="demoMembers" :amount-luna="250000" :directory="demoDirectory" />
        <p class="demo-note small">
          You owe Bea, Bea owes Cal, Cal owes you. Three payments, three fees, three reminders — for
          nothing. Loop spots the ring and deletes it. Everyone is square, nobody moved a coin.
        </p>
      </section>

      <ul class="points">
        <li>
          <span class="point-icon" aria-hidden="true">➊</span>
          <div>
            <strong>Start a tab</strong>
            <p class="small muted">A trip, a flat, a dinner. Share the code, people join.</p>
          </div>
        </li>
        <li>
          <span class="point-icon" aria-hidden="true">➋</span>
          <div>
            <strong>Add what you paid</strong>
            <p class="small muted">Split evenly, by exact amounts, or by shares.</p>
          </div>
        </li>
        <li>
          <span class="point-icon" aria-hidden="true">➌</span>
          <div>
            <strong>Settle in one tap</strong>
            <p class="small muted">Real NIM, straight from your wallet, with a receipt on-chain.</p>
          </div>
        </li>
      </ul>

      <p v-if="erased" class="stat small">
        <strong class="mono">{{ erased }} NIM</strong> of debt erased so far without anybody paying
        anything.
      </p>

      <div v-if="pendingInviteCode" class="invite-note card">
        <p class="small">
          You've been invited to a tab. Sign in and Loop will drop you straight into it.
        </p>
      </div>

      <div class="cta">
        <button
          v-if="!outside"
          class="btn btn--primary btn--block"
          type="button"
          :disabled="signingIn || checking"
          @click="signIn"
        >
          <span v-if="signingIn" class="cta-spinner" aria-hidden="true" />
          {{ signingIn ? 'Waiting for your wallet…' : checking ? 'Connecting…' : 'Sign in with Nimiq Pay' }}
        </button>

        <p v-if="!outside" class="cta-note tiny muted">
          Your wallet signs a one-line message to prove the address is yours. No funds move, and Loop
          never sees your keys.
        </p>

        <div v-if="outside" class="outside card">
          <h3>Open this in Nimiq Pay</h3>
          <p class="small muted">
            Loop uses your Nimiq wallet to sign in and to settle up, so it needs to run inside Nimiq
            Pay. Everything above is what it does — the rest needs the wallet.
          </p>
          <a class="btn btn--ghost btn--block" href="https://nimiq.com/nimiq-pay/" target="_blank" rel="noopener">
            Get Nimiq Pay
          </a>
          <p class="tiny muted">
            Already have it? Open Nimiq Pay → Mini Apps → paste this page's address.
          </p>
        </div>

        <p v-if="globalError" class="error small" role="alert">{{ globalError }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  padding-top: calc(env(safe-area-inset-top) + 32px);
}

.hero {
  text-align: center;
  margin-bottom: 24px;
}

.logo {
  width: 56px;
  height: 56px;
  margin: 0 auto 12px;
  color: var(--nq-light-blue);
}

.logo svg {
  width: 100%;
  height: 100%;
}

h1 {
  font-size: 40px;
  letter-spacing: -0.03em;
}

.tagline {
  margin-top: 6px;
  font-size: 17px;
  font-weight: 700;
  color: var(--ink-50);
}

.pitch {
  margin-bottom: 16px;
}

.pitch-lead {
  font-size: 16px;
  line-height: 1.55;
}

.demo {
  margin-bottom: 20px;
  text-align: center;
}

.demo-title {
  margin: 4px 0 12px;
  font-size: 19px;
}

.demo-note {
  margin-top: 10px;
  color: var(--ink-70);
  line-height: 1.5;
  text-align: left;
}

.points {
  list-style: none;
  margin: 0 0 20px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.points li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.point-icon {
  flex: 0 0 auto;
  font-size: 18px;
  color: var(--nq-light-blue);
  line-height: 1.4;
}

.points strong {
  font-size: 15px;
}

.stat {
  text-align: center;
  color: var(--ink-70);
  margin-bottom: 16px;
}

.stat strong {
  color: var(--nq-green);
}

.invite-note {
  margin-bottom: 16px;
  background: rgba(5, 130, 202, 0.08);
  box-shadow: none;
}

.cta {
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin: 0 calc(var(--gutter) * -1);
  padding: 16px var(--gutter) calc(16px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* A solid footing, with a short fade above it, so the page scrolling
     underneath never shows through the button. */
  background: linear-gradient(to bottom, rgba(242, 242, 245, 0) 0%, var(--bg) 22%, var(--bg) 100%);
}

.cta-spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  animation: spin 0.8s linear infinite;
}

.cta-note {
  text-align: center;
  line-height: 1.45;
}

.outside {
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: center;
}

.outside h3 {
  font-size: 17px;
}

.error {
  color: var(--nq-red);
  font-weight: 600;
  text-align: center;
}
</style>
