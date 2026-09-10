<script setup lang="ts">
/**
 * Catch-all page: `/<app>/<slug...>` → document → page template → tree.
 */
import { computed, watch, watchEffect } from 'vue'
import { createError, updateAppConfig, useHead, useRoute } from '#app'
import { useBlueprintDocument } from '../composables/useBlueprintDocument'
import { useBlueprint } from '../composables/useBlueprint'
import BlueprintTree from './../components/BlueprintTree'

const route = useRoute()
const app = computed(() => String(route.params.app || ''))

const { data: document } = await useBlueprintDocument(app)
if (!document.value) {
  throw createError({ statusCode: 404, statusMessage: `No Blueprint application named "${app.value}"`, fatal: true })
}

const runtime = useBlueprint(document.value)
const page = runtime.page

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: `"${runtime.context.value.path}" is not a page of "${app.value}"`, fatal: true })
}

// Page `enter` actions: run for the first page during setup (so SSR sees
// the resulting state) and again whenever the page or its params change.
const pageKey = () => `${page.value?.name || ''}?${JSON.stringify(page.value?.params || {})}`
const runEnter = async () => {
  const enter = page.value?.template.enter
  if (enter) await runtime.run(enter)
}
await runEnter()
watch(pageKey, (next, previous) => {
  if (next !== previous) runEnter()
})

const meta = document.value.content.meta
if (meta.theme) {
  updateAppConfig({ ui: { colors: { ...meta.theme } } })
}

useHead(() => ({
  title: page.value?.template.title ? `${page.value.template.title} · ${meta.title}` : meta.title,
  meta: [{ name: 'description', content: page.value?.template.description || meta.description || '' }],
  htmlAttrs: { lang: meta.locale?.split('-')[0] || 'en' },
}))

watchEffect(() => {
  if (import.meta.client && !page.value && route.params.app === app.value) {
    // Navigated inside the app to a slug that has no page.
    console.warn(`[blueprint] no page matches ${runtime.context.value.path}`)
  }
})
</script>

<template>
  <UApp>
    <BlueprintTree
      v-if="page"
      :nodes="runtime.tree.value"
      :runtime="runtime"
    />
    <UContainer
      v-else
      class="py-16"
    >
      <UEmpty
        icon="i-lucide-map-pin-off"
        title="Page not found"
        :description="`No page of “${meta.title}” matches this address.`"
      />
    </UContainer>
  </UApp>
</template>
