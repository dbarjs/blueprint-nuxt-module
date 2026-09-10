export type BlueprintErrorCode
  = | 'UNKNOWN_OPERATOR'
    | 'UNKNOWN_DEFINITION'
    | 'UNKNOWN_RESOURCE'
    | 'UNKNOWN_SCHEMA'
    | 'UNKNOWN_TEMPLATE'
    | 'UNKNOWN_ACTION'
    | 'UNKNOWN_COMPONENT'
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
