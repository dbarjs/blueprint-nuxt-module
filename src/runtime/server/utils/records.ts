import { useStorage } from 'nitropack/runtime'

export interface BlueprintRecord {
  id: string
  app: string
  schema?: string
  createdAt: string
  /** Pin: which document version produced this record. */
  createdUnder: { document: string, version: string }
  data: unknown
}

export type RecordsStorage = ReturnType<typeof useStorage<BlueprintRecord>>

export function recordsStorage(): RecordsStorage {
  return useStorage<BlueprintRecord>('blueprint')
}

export function recordKey(app: string, id: string) {
  return `records:${app}:${id}`
}
