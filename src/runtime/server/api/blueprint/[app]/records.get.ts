import { defineEventHandler, getRouterParam } from 'h3'
import { recordsStorage, type BlueprintRecord } from '../../../utils/records'

/** List the records of an app (newest first). */
export default defineEventHandler(async (event) => {
  const app = getRouterParam(event, 'app') || ''
  const storage = recordsStorage()
  const keys: string[] = await storage.getKeys(`records:${app}:`)
  const records: Array<BlueprintRecord | null> = await Promise.all(keys.map((key: string) => storage.getItem(key)))
  return records
    .filter((record): record is BlueprintRecord => record !== null)
    .sort((a: BlueprintRecord, b: BlueprintRecord) => (a.createdAt < b.createdAt ? 1 : -1))
})
