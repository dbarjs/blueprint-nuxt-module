import { createError, defineEventHandler, getRouterParam } from 'h3'
import { recordKey, recordsStorage } from '../../../../utils/records'

export default defineEventHandler(async (event) => {
  const app = getRouterParam(event, 'app') || ''
  const id = getRouterParam(event, 'id') || ''
  const record = await recordsStorage().getItem(recordKey(app, id))
  if (!record) throw createError({ statusCode: 404, statusMessage: `Record "${id}" not found` })
  return record
})
