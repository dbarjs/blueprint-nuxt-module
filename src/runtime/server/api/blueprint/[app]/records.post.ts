import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { queryCollection } from '@nuxt/content/nitro'
import { validateSchema } from '../../../../engine/schema'
import { createEvaluator } from '../../../../engine/logic'
import { createId, hashDocument } from '../../../../engine/hash'
import type { BlueprintDocument } from '../../../../engine/types'
import { recordKey, recordsStorage, type BlueprintRecord } from '../../../utils/records'

/**
 * Create a pinned record (an order, a quote...) for an app.
 *
 * The server validates again with the same engine validator the client
 * used, against the document currently published — and refuses a payload
 * pinned to a different version than the one it can see.
 */
export default defineEventHandler(async (event) => {
  const app = getRouterParam(event, 'app') || ''
  const body = await readBody<{ schema?: string, data: unknown, createdUnder?: { document: string, version: string } }>(event)
  if (!body || body.data === undefined) throw createError({ statusCode: 400, statusMessage: 'Missing "data"' })

  const item = (await queryCollection(event, 'blueprints').where('stem', '=', app).first()) as unknown as (Record<string, unknown> & { name?: string }) | null
  if (!item) throw createError({ statusCode: 404, statusMessage: `Unknown application "${app}"` })
  const document = { ...item, name: item.name || app } as unknown as BlueprintDocument
  const version = hashDocument(document)

  if (body.createdUnder && body.createdUnder.version !== version) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The document changed since this payload was built. Reload and try again.',
      data: { expected: version, received: body.createdUnder.version },
    })
  }

  if (body.schema) {
    const schema = document.content.schemas?.[body.schema]
    if (!schema) throw createError({ statusCode: 400, statusMessage: `Unknown schema "${body.schema}"` })
    const evaluator = createEvaluator(document)
    const issues = validateSchema(schema, body.data, {
      document,
      evaluator,
      scope: { state: (body.data as Record<string, unknown>) || {}, context: { app }, vars: {} },
    })
    if (issues.length) throw createError({ statusCode: 422, statusMessage: 'Validation failed', data: { issues } })
  }

  const record: BlueprintRecord = {
    id: createId(),
    app,
    schema: body.schema,
    createdAt: new Date().toISOString(),
    createdUnder: { document: app, version },
    data: body.data,
  }
  await recordsStorage().setItem(recordKey(app, record.id), record)
  return record
})
