<script setup lang="ts">
import { computed } from 'vue'
import WelcomeView from './views/WelcomeView.vue'
import HomeView from './views/HomeView.vue'
import TabView from './views/TabView.vue'
import SettleView from './views/SettleView.vue'
import ActivityView from './views/ActivityView.vue'
import ProfileView from './views/ProfileView.vue'
import { booting, plan, screen, signedIn, toast } from './lib/store.js'

const owedCount = computed(() => plan.value?.youOwe.length ?? 0)

const tabs = [
  { key: 'home', label: 'Tabs', icon: 'tabs' },
  { key: 'settle', label: 'Settle', icon: 'settle' },
  { key: 'activity', label: 'Activity', icon: 'activity' },
  { key: 'profile', label: 'You', icon: 'profile' },
] as const

function go(key: (typeof tabs)[number]['key']) {
  screen.value = key
}
</script>

<template>
  <div v-if="booting" class="boot">
    <div class="boot-mark" aria-hidden="true" />
    <p class="sr-only">Loading Loop</p>
  </div>

  <template v-else>
    <WelcomeView v-if="!signedIn" />

    <template v-else>
      <HomeView v-if="screen === 'home'" />
      <TabView v-else-if="screen === 'tab'" />
      <SettleView v-else-if="screen === 'settle'" />
      <ActivityView v-else-if="screen === 'activity'" />
      <ProfileView v-else-if="screen === 'profile'" />
      <HomeView v-else />

      <nav class="nav" aria-label="Main">
        <button
          v-for="item in tabs"
          :key="item.key"
          type="button"
          class="nav-item"
          :class="{ 'is-active': screen === item.key || (item.key === 'home' && screen === 'tab') }"
          :aria-current="screen === item.key ? 'page' : undefined"
          @click="go(item.key)"
        >
          <span class="nav-icon" aria-hidden="true">
            <svg v-if="item.icon === 'tabs'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="6" rx="2" />
              <rect x="3" y="14" width="18" height="6" rx="2" />
            </svg>
            <svg v-else-if="item.icon === 'settle'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 3l4 4-4 4" />
              <path d="M21 7H8a4 4 0 0 0-4 4v1" />
              <path d="M7 21l-4-4 4-4" />
              <path d="M3 17h13a4 4 0 0 0 4-4v-1" />
            </svg>
            <svg v-else-if="item.icon === 'activity'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12h4l3 8 4-16 3 8h4" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
            </svg>
          </span>
          <span class="nav-label">{{ item.label }}</span>
          <span v-if="item.key === 'settle' && owedCount > 0" class="nav-dot" aria-hidden="true" />
        </button>
      </nav>
    </template>
  </template>

  <Transition name="toast">
    <div v-if="toast" class="toast" :class="`toast--${toast.tone}`" role="status" aria-live="polite">
      {{ toast.text }}
    </div>
  </Transition>
</template>

<style scoped>
.boot {
  min-height: 100dvh;
  display: grid;
  place-items: center;
}

.boot-mark {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 3px solid var(--ink-12);
  border-top-color: var(--nq-light-blue);
  animation: spin 0.9s linear infinite;
}

.nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(16px);
  border-top: 1px solid var(--ink-06);
}

.nav-item {
  position: relative;
  flex: 1 1 0;
  max-width: 120px;
  min-height: var(--tap);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px;
  border-radius: var(--radius);
  color: var(--ink-50);
  transition: color 0.15s ease;
}

.nav-item.is-active {
  color: var(--nq-light-blue);
}

.nav-item:active {
  background: var(--ink-06);
}

.nav-icon {
  display: block;
  width: 22px;
  height: 22px;
}

.nav-icon svg {
  width: 100%;
  height: 100%;
}

.nav-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.nav-dot {
  position: absolute;
  top: 6px;
  right: 50%;
  margin-right: -18px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--nq-orange);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.92);
}

.toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(var(--nav-height) + env(safe-area-inset-bottom) + 16px);
  z-index: 200;
  max-width: calc(100vw - 32px);
  padding: 12px 18px;
  border-radius: 999px;
  background: var(--nq-blue);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  box-shadow: var(--shadow-lg);
  text-align: center;
}

.toast--good {
  background: var(--nq-green);
}

.toast--bad {
  background: var(--nq-red);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
