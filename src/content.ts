/**
 * Helper for projects that define their own `content.config.ts` (for
 * example when `@nuxt/content` is listed before `blueprint-nuxt-module`).
 *
 * ```ts
 * import { defineContentConfig } from '@nuxt/content'
 * import { defineBlueprintCollection } from 'blueprint-nuxt-module/content'
 *
 * export default defineContentConfig({
 *   collections: { blueprints: defineBlueprintCollection() },
 * })
 * ```
 */
import { defineCollection, z } from '@nuxt/content'

export function defineBlueprintCollection(options: { cwd?: string, include?: string } = {}) {
  return defineCollection({
    type: 'data',
    source: { include: options.include || '**/*.json', ...(options.cwd ? { cwd: options.cwd } : {}) },
    schema: z.object({
      name: z.string().optional(),
      id: z.string().optional(),
      from: z.object({}).passthrough().optional(),
      content: z.object({}).passthrough(),
    }),
  })
}
