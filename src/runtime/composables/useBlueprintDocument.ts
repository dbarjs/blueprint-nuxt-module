import { computed, type Ref } from 'vue'
import { useAsyncData, createError, type AsyncData } from '#app'
import { queryCollection } from '#imports'
import type { BlueprintDocument } from '../engine/types'

/**
 * Load a Blueprint document from the `blueprints` Nuxt Content collection by
 * its file stem (which is also the URL prefix of the app).
 */
export async function useBlueprintDocument(app: string | Ref<string>): Promise<AsyncData<BlueprintDocument | null, Error | null>> {
  const name = computed(() => typeof app === 'string' ? app : app.value)
  const asyncData = await useAsyncData(`blueprint:document:${name.value}`, async () => {
    const item = (await queryCollection('blueprints').where('stem', '=', name.value).first()) as unknown as (Record<string, unknown> & { stem: string }) | null
    if (!item) return null
    const document = { ...item } as unknown as BlueprintDocument
    document.name = document.name || item.stem
    return document
  }, { watch: [name] })
  return asyncData as AsyncData<BlueprintDocument | null, Error | null>
}

export function requireBlueprintDocument(document: BlueprintDocument | null | undefined, app: string): BlueprintDocument {
  if (!document) {
    throw createError({ statusCode: 404, statusMessage: `No Blueprint document named "${app}"`, fatal: true })
  }
  return document
}
