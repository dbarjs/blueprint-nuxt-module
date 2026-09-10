export type BlueprintErrorCode
  = | 'UNKNOWN_OPERATOR'
    | 'UNKNOWN_DEFINITION'
    | 'UNKNOWN_RESOURCE'
    | 'UNKNOWN_SCHEMA'
    | 'UNKNOWN_TEMPLATE'
    | 'UNKNOWN_ACTION'
    | 'UNKNOWN_COMPONENT'
    | 'UNKNOWN_COLLECTION'
    | 'UNKNOWN_ENDPOINT'
    | 'UNKNOWN_STORAGE'
    | 'UNSUPPORTED_ACTION'
    | 'MISSING_PARAM'
    | 'INVALID_RECORD'
    | 'DEFINITION_CYCLE'
    | 'DIVISION_BY_ZERO'
    | 'NOT_A_NUMBER'
    | 'LOOKUP_NO_MATCH'
    | 'LOOKUP_AMBIGUOUS'
    | 'INVALID_DOCUMENT'
    | 'INVALID_ARGUMENTS'
    | 'VALIDATION_FAILED'
    | 'SUBMIT_FAILED'
    | 'TEST_FAILED'
    | 'ACTION_CYCLE'
    | 'UNSUPPORTED_SPEC'
    | 'CAPABILITY_MISSING'
    | 'CAPABILITY_UNAVAILABLE'
    | 'CAPABILITY_VERSION'
    | 'PROJECTION_DANGLING'
    | 'UNSTUBBED_EFFECT'
    | 'INVALID_TEST'

/** A failure as a value (ADR 0008): what a handler's `catch` sees. */
export interface ActionFailure {
  code: string
  message: string
  issues?: unknown
  status?: number
}

export function toFailure(error: unknown): ActionFailure {
  if (error instanceof BlueprintError) {
    const details = (error.details || {}) as Partial<ActionFailure>
    return { code: error.code, message: error.message.replace(/^\[blueprint:[A-Z_]+\] /, ''), ...(details.issues !== undefined ? { issues: details.issues } : {}), ...(details.status !== undefined ? { status: details.status } : {}) }
  }
  if (error && typeof error === 'object' && typeof (error as ActionFailure).code === 'string') return error as ActionFailure
  return { code: 'EFFECT_FAILED', message: String((error as Error)?.message || error) }
}

export class BlueprintError extends Error {
  code: BlueprintErrorCode
  details?: unknown

  constructor(code: BlueprintErrorCode, message: string, details?: unknown) {
    super(`[blueprint:${code}] ${message}`)
    this.name = 'BlueprintError'
    this.code = code
    this.details = details
  }
}
