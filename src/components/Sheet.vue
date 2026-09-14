<script setup lang="ts">
/**
 * A bottom sheet — the right shape for a thumb on a phone.
 *
 * Closes on backdrop tap and on Escape, traps nothing (there is only ever one
 * open), and never triggers a native dialog on its own.
 */
import { onBeforeUnmount, onMounted, watch } from 'vue'

const props = defineProps<{ open: boolean; title: string }>()
const emit = defineEmits<{ close: [] }>()

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})

watch(
  () => props.open,
  (open) => {
    // Stop the page behind from scrolling while the sheet is up.
    document.body.style.overflow = open ? 'hidden' : ''
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="sheet-root" role="dialog" aria-modal="true" :aria-label="title">
        <div class="sheet-backdrop" @click="emit('close')" />
        <div class="sheet-panel">
          <div class="sheet-grip" aria-hidden="true" />
          <header class="sheet-head">
            <h2>{{ title }}</h2>
            <button class="sheet-close" type="button" aria-label="Close" @click="emit('close')">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          <div class="sheet-body">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-root {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.sheet-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(31, 35, 72, 0.45);
  backdrop-filter: blur(2px);
}

.sheet-panel {
  position: relative;
  width: 100%;
  max-width: 560px;
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: 24px 24px 0 0;
  box-shadow: var(--shadow-lg);
  padding-bottom: env(safe-area-inset-bottom);
}

.sheet-grip {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--ink-12);
  margin: 10px auto 2px;
  flex: 0 0 auto;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 20px 12px;
  flex: 0 0 auto;
}

.sheet-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--tap);
  height: var(--tap);
  margin-right: -10px;
  border-radius: 50%;
  color: var(--ink-50);
}

.sheet-close:active {
  background: var(--ink-06);
}

.sheet-body {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 20px 24px;
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.22s ease;
}

.sheet-enter-active .sheet-panel,
.sheet-leave-active .sheet-panel {
  transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-from .sheet-panel,
.sheet-leave-to .sheet-panel {
  transform: translateY(100%);
}
</style>
