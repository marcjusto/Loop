<script setup lang="ts">
import { computed } from 'vue'
import { avatarColor, initials } from '../lib/format.js'

const props = withDefaults(
  defineProps<{
    name: string
    seed: number
    size?: 'sm' | 'md' | 'lg'
  }>(),
  { size: 'md' },
)

const style = computed(() => ({ background: avatarColor(props.seed) }))
const text = computed(() => initials(props.name))
</script>

<template>
  <span
    class="avatar"
    :class="{ 'avatar--sm': size === 'sm', 'avatar--lg': size === 'lg' }"
    :style="style"
    :title="name"
    aria-hidden="true"
  >
    {{ text }}
  </span>
</template>
