/**
 * Manifests (ADR 0009): what a runtime provides, what a published version
 * requires, and the portability verdict between them (ADR 0026).
 *
 * - The **runtime manifest** is the contract re-expressed as capabilities.
 * - The **version manifest** is derived entirely from the document: section
 *   hashes, derived requirements, portability level and status.
 * - Compatibility is computed (`checkCompatibility`) and printed, never
 *   promised.
 */
import type { BlueprintDocument, BlueprintTest } from './types'
import { SPEC_RANGE, SPEC_VERSION } from './types'
import { CAPABILITIES, checkCompatibility, requirementsOf, type CompatibilityReport, type Provided, type Requirements } from './capabilities'
import { refsOfDocument, type RefSet } from './refs'
import { RUNTIME_CONTRACT, type RuntimeContract } from './contract'
import { fnv1a64, hashDocument, hashValue } from './hash'
import { isPageTemplate, routeOf } from './template'
import { BASE_COMPONENT_NAMES } from './registry'
import { testFormOf } from './test-forms'

export interface RuntimeManifest {
  runtime: string
  version: string
  /** Kernel range implemented. */
  spec: string
  engine: { name: string, version: string, build?: string }
  surfaces: string[]
  provides: Provided[]
  materializers: Array<{ surface: string, target: string, vocabularies: string[] }>
  /** Vocabulary adapters shipped by the runtime (ADR 0026, rule 4). */
  adapters: Array<{ from: string, to: string, version: string }>
}

/** Build metadata for a vocabulary: the hash of its sorted component names. */
export function registryHash(names: string[]): string {
  return fnv1a64([...names].sort().join('\n')).slice(0, 12)
}

/** The runtime manifest of a (resolved) contract. */
export function runtimeManifestOf(contract: RuntimeContract = RUNTIME_CONTRACT): RuntimeManifest {
  const { base, nuxtUi, app } = contract.client.components
  const version = (name: string) => CAPABILITIES[name]?.version || '1.0.0'
  const provides: Provided[] = [
    { name: 'web.pages', version: version('web.pages'), surface: 'client', options: { prefix: contract.client.prefix } },
    { name: 'web.state', version: version('web.state'), surface: 'client', options: { persistence: contract.client.state.persistence } },
    { name: 'web.router', version: version('web.router'), surface: 'client' },
    { name: 'ui.toast', version: version('ui.toast'), surface: 'client' },
    { name: 'http.client', version: version('http.client'), surface: 'client' },
    { name: 'http.endpoints', version: version('http.endpoints'), surface: 'server', options: { mount: contract.server.mount, methods: contract.server.methods } },
    { name: 'storage.collections', version: version('storage.collections'), surface: 'server', options: { backends: contract.server.storages.map(entry => entry.name), default: contract.server.defaultStorage, recordFields: contract.server.recordFields } },
    { name: 'time.now', version: version('time.now'), surface: 'any' },
    { name: 'records.pinned', version: version('records.pinned'), surface: 'server' },
    { name: 'vocab.base', version: version('vocab.base'), surface: 'client', components: [...base] },
  ]
  if (nuxtUi.length) provides.push({ name: 'vocab.nuxt-ui', version: `0.0.0+${registryHash(nuxtUi)}`, surface: 'client', components: [...nuxtUi] })
  if (app.length) provides.push({ name: 'vocab.app', version: `0.0.0+${registryHash(app)}`, surface: 'client', components: [...app] })
  return {
    runtime: contract.runtime,
    version: contract.version,
    spec: SPEC_RANGE,
    engine: { name: 'blueprint-engine', version: contract.version },
    surfaces: ['build', 'server', 'client'],
    provides,
    materializers: [{ surface: 'client', target: 'vue', vocabularies: provides.filter(entry => entry.name.startsWith('vocab.')).map(entry => entry.name) }],
    adapters: [],
  }
}

export type PortabilityLevel = 'L0' | 'L1' | 'L2' | 'L3'
export type PortabilityStatus = 'portable' | 'degradable' | 'LOCKED'

export interface Portability {
  level: PortabilityLevel
  status: PortabilityStatus
  /** Non-base components without a fallback, by node. */
  locked: Array<{ component: string, where: string }>
  /** Non-base components that carry a fallback. */
  degradable: string[]
  /** Vocabularies beyond `vocab.base` the document uses. */
  vocabularies: string[]
  /** Raw html / class escapes. */
  escapes: string[]
}

/** The minimum common runtime (ADR 0005): the standard interfaces every full runtime provides. */
export const MINIMUM_COMMON_RUNTIME = ['web.pages', 'web.state', 'web.router', 'ui.toast', 'http.client', 'http.endpoints', 'storage.collections', 'time.now', 'records.pinned']

export function portabilityOf(document: BlueprintDocument, refs: Record<string, RefSet> = refsOfDocument(document), requirements: Requirements = requirementsOf(document, refs)): Portability {
  const base = new Set(BASE_COMPONENT_NAMES)
  const locked: Array<{ component: string, where: string }> = []
  const degradable = new Set<string>()
  const escapes: string[] = []
  const components = new Set<string>()
  for (const set of Object.values(refs)) {
    locked.push(...set.locked)
    escapes.push(...set.escapes)
    for (const component of set.components) components.add(component)
  }
  const lockedNames = new Set(locked.map(entry => entry.component))
  for (const component of components) if (!base.has(component) && !lockedNames.has(component)) degradable.add(component)
  const names = Object.keys({ ...requirements.requires, ...requirements.optional })
  const vocabularies = names.filter(name => name.startsWith('vocab.') && name !== 'vocab.base')
  const beyondCommon = names.filter(name => !MINIMUM_COMMON_RUNTIME.includes(name) && name !== 'vocab.base')
  const hasOptions = Object.keys(requirements.options).length > 0
  let level: PortabilityLevel
  if (beyondCommon.length || hasOptions) level = 'L3'
  else if (names.some(name => name !== 'vocab.base')) level = 'L2'
  else if (components.size) level = 'L1'
  else level = 'L0'
  const status: PortabilityStatus = locked.length ? 'LOCKED' : (degradable.size || escapes.length) ? 'degradable' : 'portable'
  return { level, status, locked, degradable: [...degradable].sort(), vocabularies, escapes }
}

export interface VersionManifest {
  id?: string
  name: string
  version: string
  spec: string
  sections: Record<string, string>
  requires: Record<string, string>
  optional: Record<string, string>
  options: Record<string, Record<string, unknown>>
  portability: Portability
  pages: string[]
  endpoints: string[]
  tests: Record<string, number>
  from?: BlueprintDocument['from']
}

export interface VersionManifestOptions {
  /** Known component layers, to place components in vocabularies. */
  registry?: { base?: string[], nuxtUi?: string[], app?: string[] }
  /** What the publishing runtime provides: pins `vocab.*` requirements to the build seen. */
  provides?: Provided[]
}

/** Derived entirely from the document; stable and hashable itself. */
export function versionManifestOf(document: BlueprintDocument, options: VersionManifestOptions = {}): VersionManifest {
  const refs = refsOfDocument(document)
  const requirements = requirementsOf(document, refs, options.registry)
  const provided = new Map((options.provides || []).map(entry => [entry.name, entry]))
  for (const bucket of [requirements.requires, requirements.optional]) {
    for (const name of Object.keys(bucket)) {
      if (name.startsWith('vocab.') && name !== 'vocab.base' && provided.has(name)) bucket[name] = `=${provided.get(name)!.version}`
    }
  }
  const sections: Record<string, string> = {}
  for (const [key, value] of Object.entries(document.content)) if (value !== undefined) sections[key] = hashValue(value)
  const tests: Record<string, number> = {}
  for (const test of (document.content.tests || []) as BlueprintTest[]) {
    const form = testFormOf(test)
    tests[form] = (tests[form] || 0) + 1
  }
  return {
    ...(document.id ? { id: document.id } : {}),
    name: document.name,
    version: hashDocument(document),
    spec: document.spec || SPEC_VERSION,
    sections,
    requires: requirements.requires,
    optional: requirements.optional,
    options: requirements.options,
    portability: portabilityOf(document, refs, requirements),
    pages: Object.entries(document.content.templates || {}).filter(([name, template]) => name.startsWith('page:') && isPageTemplate(template)).map(([name, template]) => routeOf(name, template as Parameters<typeof routeOf>[1])),
    endpoints: Object.values(document.content.endpoints || {}).map(endpoint => `${endpoint.method} ${endpoint.path}`),
    tests,
    ...(document.from ? { from: document.from } : {}),
  }
}

/** The verdict of one version against one runtime, with the human line `validate` prints. */
export function compatibilityOf(manifest: VersionManifest, runtime: RuntimeManifest): CompatibilityReport & { line: string } {
  const report = checkCompatibility(manifest, runtime)
  const parts: string[] = [`${runtime.runtime} ${runtime.version}`, report.verdict]
  if (report.spec) parts.push(`spec ${report.spec.document} outside ${report.spec.runtime}`)
  if (report.missing.length) parts.push(report.missing.map(entry => `${entry.name}${entry.provided ? ` ${entry.provided} ∉ ${entry.required}` : ' missing'}`).join(', '))
  if (report.unavailable.length) parts.push(`${report.unavailable.map(entry => entry.name).join(', ')} unavailable`)
  return { ...report, line: parts.join('  ') }
}

/** The one-line portability summary (ADR 0026): `health-quote  L2  portable  (kernel + minimum common runtime)`. */
export function portabilityLine(manifest: VersionManifest): string {
  const { portability } = manifest
  let detail: string
  if (portability.status === 'LOCKED') detail = `${[...new Set(portability.locked.map(entry => entry.component))].join(', ')} without fallback`
  else if (portability.status === 'degradable') detail = `${[...portability.degradable, ...(portability.escapes.length ? [`${portability.escapes.length} html escapes`] : [])].join(', ')} via fallback on runtimes without ${portability.vocabularies.join(', ') || 'the vocabulary'}`
  else detail = portability.level === 'L0' ? 'kernel only' : portability.level === 'L1' ? 'vocab.base only' : 'kernel + minimum common runtime'
  return `${manifest.name}  ${portability.level}  ${portability.status}  (${detail})`
}
