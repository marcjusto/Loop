<script setup lang="ts">
/**
 * The picture that explains the whole app in one glance.
 *
 * A ring of people, an arrow from each to the next, and the amount that went
 * all the way around and came back to where it started. Once you see the
 * circle, "nobody needs to pay anybody" stops needing a paragraph.
 *
 * Drawn as inline SVG so it scales, prints and screenshots cleanly, and needs
 * no chart library.
 */
import { computed } from 'vue'
import { avatarColor, formatNim, initials, nameFor } from '../lib/format.js'
import type { Member } from '../lib/api.js'

const props = defineProps<{
  members: string[]
  amountLuna: number
  directory: Member[]
  self?: string | null
}>()

const SIZE = 240
const CENTER = SIZE / 2
const RADIUS = 84
const NODE = 21

interface Node {
  address: string
  x: number
  y: number
  label: string
  color: string
  isSelf: boolean
}

const nodes = computed<Node[]>(() => {
  const count = props.members.length
  return props.members.map((address, i) => {
    // Start at the top and go clockwise, the way people read a clock face.
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2
    const member = props.directory.find((m) => m.address === address)
    const isSelf = address === props.self
    return {
      address,
      x: CENTER + Math.cos(angle) * RADIUS,
      y: CENTER + Math.sin(angle) * RADIUS,
      // Your own node says so. Finding yourself in the ring is the whole point.
      label: isSelf ? 'YOU' : initials(member?.displayName ?? address.slice(-4)),
      color: avatarColor(member?.avatarSeed ?? 0),
      isSelf,
    }
  })
})

/**
 * Arc from each node to the next, stopping short of the node circles so the
 * arrowhead lands in open space rather than under an avatar.
 */
const arcs = computed(() => {
  const list = nodes.value
  return list.map((node, i) => {
    const next = list[(i + 1) % list.length]
    const dx = next.x - node.x
    const dy = next.y - node.y
    const length = Math.hypot(dx, dy) || 1
    const gap = NODE + 7
    const start = { x: node.x + (dx / length) * gap, y: node.y + (dy / length) * gap }
    const end = { x: next.x - (dx / length) * gap, y: next.y - (dy / length) * gap }

    // Bow each arc outward from the middle so two-person rings do not overlap.
    const midX = (start.x + end.x) / 2
    const midY = (start.y + end.y) / 2
    const outX = midX - CENTER
    const outY = midY - CENTER
    const outLength = Math.hypot(outX, outY) || 1
    const bow = list.length === 2 ? 26 : 14
    const ctrl = { x: midX + (outX / outLength) * bow, y: midY + (outY / outLength) * bow }

    return {
      d: `M ${start.x} ${start.y} Q ${ctrl.x} ${ctrl.y} ${end.x} ${end.y}`,
      delay: i * 0.12,
    }
  })
})

const names = computed(() =>
  props.members.map((address) => nameFor(address, props.directory, props.self ?? undefined)),
)

const caption = computed(() => {
  const list = names.value
  if (list.length === 2) return `${cap(list[0])} and ${list[1]} cancel each other out.`
  const chain = list.map(cap).join(' → ')
  return `${chain} → back to ${list[0]}.`
})

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
</script>

<template>
  <figure class="ring">
    <svg :viewBox="`0 0 ${SIZE} ${SIZE}`" class="ring-svg" role="img" :aria-label="caption">
      <defs>
        <marker
          id="loop-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--nq-green)" />
        </marker>
      </defs>

      <circle
        :cx="CENTER"
        :cy="CENTER"
        :r="RADIUS + 4"
        fill="none"
        stroke="var(--nq-green)"
        stroke-opacity="0.1"
        stroke-width="28"
      />

      <path
        v-for="(arc, i) in arcs"
        :key="`arc-${i}`"
        :d="arc.d"
        class="ring-arc"
        :style="{ animationDelay: `${arc.delay}s` }"
        fill="none"
        stroke="var(--nq-green)"
        stroke-width="2.5"
        stroke-linecap="round"
        marker-end="url(#loop-arrow)"
      />

      <g v-for="node in nodes" :key="node.address">
        <circle
          :cx="node.x"
          :cy="node.y"
          :r="NODE"
          :fill="node.color"
          :stroke="node.isSelf ? 'var(--nq-blue)' : '#fff'"
          :stroke-width="node.isSelf ? 3 : 2"
        />
        <text
          :x="node.x"
          :y="node.y"
          text-anchor="middle"
          dominant-baseline="central"
          fill="#fff"
          :font-size="node.isSelf ? 10 : 13"
          font-weight="800"
          font-family="Mulish, sans-serif"
        >
          {{ node.label }}
        </text>
      </g>

      <g class="ring-centre">
        <text
          :x="CENTER"
          :y="CENTER - 8"
          text-anchor="middle"
          fill="var(--nq-green)"
          font-size="20"
          font-weight="900"
          font-family="'Fira Mono', monospace"
        >
          {{ formatNim(amountLuna) }}
        </text>
        <text
          :x="CENTER"
          :y="CENTER + 11"
          text-anchor="middle"
          fill="var(--ink-50)"
          font-size="10"
          font-weight="800"
          letter-spacing="1.4"
          font-family="Mulish, sans-serif"
        >
          NIM ERASED
        </text>
      </g>
    </svg>
    <figcaption class="ring-caption small muted">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.ring {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.ring-svg {
  width: 100%;
  max-width: 240px;
  height: auto;
  display: block;
}

.ring-arc {
  stroke-dasharray: 200;
  stroke-dashoffset: 200;
  animation: draw 0.7s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes draw {
  to {
    stroke-dashoffset: 0;
  }
}

.ring-centre {
  animation: pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s backwards;
  transform-origin: center;
}

@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
}

.ring-caption {
  text-align: center;
  max-width: 32ch;
}

@media (prefers-reduced-motion: reduce) {
  .ring-arc {
    stroke-dashoffset: 0;
    animation: none;
  }
  .ring-centre {
    animation: none;
  }
}
</style>
