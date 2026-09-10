<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  level?: 1 | 2 | 3 | 4
  color?: 'default' | 'muted' | 'primary'
  align?: 'left' | 'center' | 'right'
}>(), { level: 2, color: 'default', align: 'left' })

const LEVEL = {
  1: 'text-3xl sm:text-4xl font-bold tracking-tight',
  2: 'text-2xl font-bold tracking-tight',
  3: 'text-xl font-semibold',
  4: 'text-base font-semibold',
} as const
const COLOR = { default: 'text-highlighted', muted: 'text-muted', primary: 'text-primary' } as const
const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const

const tag = computed(() => `h${props.level}`)
const classes = computed(() => [LEVEL[props.level], COLOR[props.color], ALIGN[props.align]])
</script>

<template>
  <component
    :is="tag"
    :class="classes"
  >
    <slot />
  </component>
</template>
