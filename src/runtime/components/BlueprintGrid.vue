<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  cols?: 1 | 2 | 3 | 4 | 5 | 6
  gap?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
}>(), { cols: 3, gap: 'md' })

const COLS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
} as const
const GAP = { none: 'gap-0', xs: 'gap-1', sm: 'gap-2', md: 'gap-4', lg: 'gap-6', xl: 'gap-10' } as const

const classes = computed(() => ['grid', COLS[props.cols], GAP[props.gap]])
</script>

<template>
  <div :class="classes">
    <slot />
  </div>
</template>
