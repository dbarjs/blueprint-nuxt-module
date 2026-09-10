<script setup lang="ts">
/**
 * Landing page listing every Blueprint application found in `content/`.
 */
import { useHead, useRuntimeConfig } from '#app'

const config = useRuntimeConfig().public.blueprint as { prefix: string, apps: Array<{ name: string, title: string, description: string, icon: string }> }
useHead({ title: 'Blueprint applications' })
</script>

<template>
  <UApp>
    <UContainer class="py-16">
      <div class="flex flex-col gap-2 mb-10">
        <p class="text-sm font-medium text-primary">
          Blueprint · Nuxt module
        </p>
        <h1 class="text-3xl font-bold tracking-tight text-highlighted">
          Applications
        </h1>
        <p class="text-muted">
          Each JSON document under <code>content/</code> is a complete application. Pick one.
        </p>
      </div>
      <UPageGrid>
        <UPageCard
          v-for="app in config.apps"
          :key="app.name"
          :title="app.title"
          :description="app.description"
          :icon="app.icon || 'i-lucide-file-json'"
          :to="`${config.prefix}/${app.name}`"
        />
      </UPageGrid>
      <UEmpty
        v-if="!config.apps.length"
        class="mt-10"
        icon="i-lucide-folder-open"
        title="No documents yet"
        description="Add a <name>.json Blueprint document to the content directory."
      />
    </UContainer>
  </UApp>
</template>
