<script setup lang="ts">
/**
 * One NIM figure, optionally with its fiat estimate underneath.
 *
 * The fiat line is always marked as an approximation, because it is: the rate
 * moves, and the thing people actually owe each other is the NIM.
 */
import { computed } from 'vue'
import { formatFiat, formatNim, lunaToFiat } from '../lib/format.js'
import { nimPrice } from '../lib/store.js'

const props = withDefaults(
  defineProps<{
    luna: number
    sign?: boolean
    fiat?: boolean
    size?: 'sm' | 'md' | 'lg' | 'xl'
  }>(),
  { sign: false, fiat: false, size: 'md' },
)

const main = computed(() => formatNim(props.luna, { sign: props.sign }))
const fiatText = computed(() => {
  const rate = nimPrice.value.rate
  if (!props.fiat || !rate) return null
  return `≈ ${formatFiat(lunaToFiat(Math.abs(props.luna), rate), nimPrice.value.currency)}`
})
</script>

<template>
  <span class="amount" :class="`amount--${size}`">
    <span class="amount-main mono">{{ main }}<span class="amount-unit">NIM</span></span>
    <span v-if="fiatText" class="amount-fiat mono">{{ fiatText }}</span>
  </span>
</template>

<style scoped>
.amount {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.2;
}

.amount-main {
  font-weight: 800;
  white-space: nowrap;
}

.amount-unit {
  font-size: 0.7em;
  font-weight: 700;
  opacity: 0.55;
  margin-left: 0.3em;
  letter-spacing: 0.02em;
}

.amount-fiat {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.5;
  white-space: nowrap;
}

.amount--sm .amount-main {
  font-size: 14px;
}

.amount--md .amount-main {
  font-size: 17px;
}

.amount--lg .amount-main {
  font-size: 24px;
}

.amount--xl .amount-main {
  font-size: 38px;
  font-weight: 900;
  letter-spacing: -0.03em;
}
</style>
