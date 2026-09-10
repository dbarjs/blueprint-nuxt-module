<script setup lang="ts">
/**
 * Base vocabulary `Image`. Without `src` it renders an icon on a tinted
 * surface, so catalogs work before photography exists.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  src?: string
  alt?: string
  ratio?: 'square' | 'video' | 'portrait' | 'wide' | 'auto'
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full'
  fit?: 'cover' | 'contain'
  icon?: string
  tone?: string
  size?: 'sm' | 'md' | 'lg'
  width?: 'xs' | 'sm' | 'md' | 'full'
}>(), { ratio: 'square', rounded: 'lg', fit: 'cover', icon: 'i-lucide-utensils', tone: 'neutral', alt: '' })

const RATIO = { square: 'aspect-square', video: 'aspect-video', portrait: 'aspect-[3/4]', wide: 'aspect-[21/9]', auto: '' } as const
const ROUNDED = { none: '', sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl', full: 'rounded-full' } as const
const TONE: Record<string, string> = {
  neutral: 'bg-elevated text-muted',
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary/10 text-secondary',
  success: 'bg-success/10 text-success',
  info: 'bg-info/10 text-info',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-error/10 text-error',
}
const ICON_SIZE = { sm: 'size-6', md: 'size-10', lg: 'size-16' } as const
const WIDTH = { xs: 'w-16 shrink-0', sm: 'w-24 shrink-0', md: 'w-40 shrink-0', full: 'w-full' } as const

const frame = computed(() => ['overflow-hidden', WIDTH[props.width || 'full'], RATIO[props.ratio], ROUNDED[props.rounded], props.src ? '' : `flex items-center justify-center ${TONE[props.tone] || TONE.neutral}`])
const image = computed(() => ['w-full h-full', props.fit === 'cover' ? 'object-cover' : 'object-contain'])
</script>

<template>
  <div :class="frame">
    <img
      v-if="src"
      :src="src"
      :alt="alt"
      :class="image"
      loading="lazy"
    >
    <UIcon
      v-else
      :name="icon"
      :class="ICON_SIZE[size || 'md']"
    />
  </div>
</template>
