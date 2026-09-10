/**
 * Tests carried by the document: state in → definition values out.
 *
 * A document that carries its own tests is self-validating and portable
 * between engines; the contract becomes "these inputs produce these
 * outputs", not the semantics of the arithmetic.
 */
import type { BlueprintDocument } from './types'
import { createEvaluator } from './logic'
import { deepClone, deepEqual, deepMerge } from './path'

export interface TestOutcome {
  name: string
  passed: boolean
  failures: Array<{ definition: string, expected: unknown, actual: unknown }>
  error?: string
}

export function runDocumentTests(document: BlueprintDocument): TestOutcome[] {
  const evaluator = createEvaluator(document)
  return (document.content.tests || []).map((test) => {
    const state = deepMerge(deepClone(document.content.state || {}), test.state)
    const context = { params: {}, query: {}, app: document.name, ...(test.context || {}) }
    const outcome: TestOutcome = { name: test.name, passed: true, failures: [] }
    try {
      evaluator.batch((evaluate) => {
        for (const [definition, expected] of Object.entries(test.expect)) {
          const actual = evaluate({ def: definition }, { state, context, vars: {} })
          if (!deepEqual(actual, expected)) {
            outcome.passed = false
            outcome.failures.push({ definition, expected, actual })
          }
        }
      })
    }
    catch (caught) {
      outcome.passed = false
      outcome.error = (caught as Error).message
    }
    return outcome
  })
}
