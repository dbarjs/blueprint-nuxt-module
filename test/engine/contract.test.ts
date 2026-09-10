import { describe, expect, it } from 'vitest'
import { componentNames, resolveContract, runtimeSchema, RUNTIME_CONTRACT, storageNames } from '../../src/runtime/engine/contract'
import { documentSchemaTemplate } from '../../src/build/artifacts'

describe('runtime contract', () => {
  it('describes both halves of the runtime', () => {
    expect(RUNTIME_CONTRACT.client.components.base).toContain('Text')
    expect(RUNTIME_CONTRACT.client.state.persistence).toBe('localStorage')
    expect(RUNTIME_CONTRACT.server.mount).toBe('/api/blueprint')
    expect(storageNames()).toEqual(['memory', 'fs', 'sqlite'])
    expect(RUNTIME_CONTRACT.actions.client).toContain('navigate')
    expect(RUNTIME_CONTRACT.actions.server).toContain('insert')
  })

  it('resolves the effective contract of a host without touching the static one', () => {
    const resolved = resolveContract(RUNTIME_CONTRACT, { prefix: '/apps', defaultStorage: 'memory', components: { nuxtUi: ['UButton'], app: ['ShopBanner'] } })
    expect(resolved.client.prefix).toBe('/apps')
    expect(resolved.server.defaultStorage).toBe('memory')
    expect(componentNames(resolved)).toEqual(['Heading', 'ShopBanner', 'Text', 'UButton', ...componentNames(RUNTIME_CONTRACT).filter(name => !['Heading', 'Text'].includes(name))].sort())
    expect(RUNTIME_CONTRACT.client.components.nuxtUi).toEqual([])
    expect(RUNTIME_CONTRACT.server.defaultStorage).toBe('fs')
  })

  it('publishes the component vocabulary in the schema, and the document schema points at it', () => {
    const resolved = resolveContract(RUNTIME_CONTRACT, { components: { nuxtUi: ['UButton'] } })
    const schema = runtimeSchema(resolved) as { $defs: Record<string, { enum?: string[] }> }
    expect(schema.$defs.component!.enum).toContain('UButton')
    expect(schema.$defs.component!.enum).toContain('Text')
    expect(schema.$defs.nodeType!.enum).toContain('outlet')
    const documentSchema = documentSchemaTemplate(resolved)
    expect(documentSchema).toContain('./runtime.schema.json#/$defs/component')
    expect(documentSchema).toContain('./runtime.schema.json#/$defs/nodeType')
  })
})
