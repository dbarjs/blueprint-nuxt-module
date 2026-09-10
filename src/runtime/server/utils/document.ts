import type { H3Event } from 'h3'
import { createError } from 'h3'
import { queryCollection } from '@nuxt/content/nitro'
import type { BlueprintDocument } from '../../engine/types'
import { hashDocument } from '../../engine/hash'

export interface PublishedDocument {
  document: BlueprintDocument
  /** Content hash — the version records and pinned requests refer to. */
  version: string
}

/**
 * The document currently published for an app, read from the Content
 * collection at request time so edits are live in development.
 */
export async function loadPublishedDocument(event: H3Event, app: string): Promise<PublishedDocument> {
  const item = (await queryCollection(event, 'blueprints').where('stem', '=', app).first()) as unknown as (Record<string, unknown> & { name?: string }) | null
  if (!item) throw createError({ statusCode: 404, statusMessage: `Unknown application "${app}"` })
  const document = { ...item, name: item.name || app } as unknown as BlueprintDocument
  return { document, version: hashDocument(document) }
}
