/** The four test forms (ADR 0011), recognised by the keys a test carries. */
import type { ActionScenario, BlueprintTest, DefinitionTest, EndpointScenario, TreeTest } from './types'

export type TestForm = 'definition' | 'tree' | 'scenario' | 'endpoint' | 'unknown'

export function testFormOf(test: BlueprintTest | Record<string, unknown>): TestForm {
  const record = test as Record<string, unknown>
  if (record.request !== undefined) return 'endpoint'
  if (record.run !== undefined) return 'scenario'
  if (record.render !== undefined) return 'tree'
  if (record.expect !== undefined || record.error !== undefined) return 'definition'
  return 'unknown'
}

export const isDefinitionTest = (test: BlueprintTest): test is DefinitionTest => testFormOf(test) === 'definition'
export const isTreeTest = (test: BlueprintTest): test is TreeTest => testFormOf(test) === 'tree'
export const isActionScenario = (test: BlueprintTest): test is ActionScenario => testFormOf(test) === 'scenario'
export const isEndpointScenario = (test: BlueprintTest): test is EndpointScenario => testFormOf(test) === 'endpoint'
