<script setup lang="ts">
/**
 * Base vocabulary `Text`: typographic tokens → Tailwind classes.
 * Every token maps to a literal class string so Tailwind can see them.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  as?: 'p' | 'span' | 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'label' | 'small' | 'strong'
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl'
  weight?: 'normal' | 'medium' | 'semibold' | 'bold'
  color?: 'default' | 'muted' | 'dimmed' | 'primary' | 'success' | 'warning' | 'error' | 'inverted'
  align?: 'left' | 'center' | 'right'
  truncate?: boolean
  lineThrough?: boolean
  italic?: boolean
  tabular?: boolean
  clamp?: 1 | 2 | 3
}>(), {
  as: 'p',
  size: 'md',
  weight: 'normal',
  color: 'default',
  align: 'left',
})

const SIZE = {
  'xs': 'text-xs',
  'sm': 'text-sm',
  'md': 'text-base',
  'lg': 'text-lg',
  'xl': 'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
  '4xl': 'text-4xl',
} as const
const WEIGHT = { normal: 'font-normal', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' } as const
const COLOR = {
  default: 'text-default',
  muted: 'text-muted',
  dimmed: 'text-dimmed',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  inverted: 'text-inverted',
} as const
const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const
const CLAMP = { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3' } as const

const classes = computed(() => [
  SIZE[props.size],
  WEIGHT[props.weight],
  COLOR[props.color],
  ALIGN[props.align],
  props.truncate ? 'truncate' : '',
  props.lineThrough ? 'line-through' : '',
  props.italic ? 'italic' : '',
  props.tabular ? 'tabular-nums' : '',
  props.clamp ? CLAMP[props.clamp] : '',
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
