<script setup lang="ts">
/**
 * Base vocabulary `Stack`: the only layout primitive documents need.
 * Direction, gap, alignment, padding and surface are tokens, never classes.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  gap?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'
  justify?: 'start' | 'center' | 'end' | 'between' | 'around'
  wrap?: boolean
  grow?: boolean
  padding?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  paddingY?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  surface?: 'none' | 'muted' | 'elevated' | 'accented' | 'primary'
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full'
  border?: boolean
  responsive?: boolean
  sticky?: 'top' | 'bottom'
  width?: 'auto' | 'full' | 'xs' | 'sm' | 'md' | 'lg'
  as?: string
}>(), {
  direction: 'column',
  gap: 'md',
  align: 'stretch',
  justify: 'start',
  padding: 'none',
  surface: 'none',
  rounded: 'none',
  width: 'auto',
  as: 'div',
})

const DIRECTION = { 'row': 'flex-row', 'column': 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' } as const
const RESPONSIVE = { 'row': 'flex-col md:flex-row', 'column': 'flex-col', 'row-reverse': 'flex-col md:flex-row-reverse', 'column-reverse': 'flex-col-reverse' } as const
const GAP = { none: 'gap-0', xs: 'gap-1', sm: 'gap-2', md: 'gap-4', lg: 'gap-6', xl: 'gap-10' } as const
const ALIGN = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch', baseline: 'items-baseline' } as const
const JUSTIFY = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between', around: 'justify-around' } as const
const PADDING = { none: 'p-0', xs: 'p-1', sm: 'p-2', md: 'p-4', lg: 'p-6', xl: 'p-10' } as const
const PADDING_Y = { none: '', xs: 'py-1', sm: 'py-2', md: 'py-4', lg: 'py-8', xl: 'py-16' } as const
const SURFACE = {
  none: '',
  muted: 'bg-muted',
  elevated: 'bg-elevated',
  accented: 'bg-accented',
  primary: 'bg-primary text-inverted',
} as const
const ROUNDED = { none: '', sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl', full: 'rounded-full' } as const
// Sticks below the app header when one is present (Nuxt UI exposes its height).
const STICKY = { top: 'sticky top-[var(--ui-header-height,0px)] z-40', bottom: 'sticky bottom-0 z-40' } as const
const WIDTH = { auto: '', full: 'w-full', xs: 'w-full max-w-xs', sm: 'w-full max-w-sm', md: 'w-full max-w-md', lg: 'w-full max-w-lg' } as const

const classes = computed(() => [
  'flex',
  props.responsive ? RESPONSIVE[props.direction] : DIRECTION[props.direction],
  GAP[props.gap],
  ALIGN[props.align],
  JUSTIFY[props.justify],
  props.wrap ? 'flex-wrap' : '',
  props.grow ? 'flex-1 min-w-0' : '',
  PADDING[props.padding],
  props.paddingY ? PADDING_Y[props.paddingY] : '',
  SURFACE[props.surface],
  ROUNDED[props.rounded],
  props.border ? 'ring ring-default' : '',
  props.sticky ? STICKY[props.sticky] : '',
  WIDTH[props.width],
])
</script>

<template>
  <component
    :is="as"
    :class="classes"
  >
    <slot />
  </component>
</template>
