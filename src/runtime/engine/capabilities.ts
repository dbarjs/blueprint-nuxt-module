/**
 * Capabilities — versioned interfaces a runtime provides and a document
 * requires (ADR 0007). A document never names a provider, only the
 * interface; requirements are derived from `refs()`, so a document cannot
 * forget one. Compatibility between a document and a runtime is computed,
 * and the answer has three values: compatible, degraded, incompatible
 * (ADR 0009).
 */
import type { BlueprintDocument } from './types'
import { SPEC_VERSION } from './types'
import { refsOfDocument, type RefSet } from './refs'
import { isPageTemplate } from './template'
import { vocabularyOf } from './registry'

export type Surface = 'client' | 'server' | 'build' | 'print' | 'any' | (string & {})
export type EffectKind = 'none' | 'network' | 'storage' | 'screen' | 'device'

/** A capability interface, as data. Providers implement it in code and pass its fixtures. */
export interface CapabilityInterface {
  name: string
  version: string
  surface: Surface
  description: string
  /** Document sections this capability owns (ADR 0006). */
  sections?: string[]
  /** Action types it adds to the closed set, and which of them end a sequence. */
  actions?: Record<string, { ends?: boolean }>
  /** Keys it injects into `context`. */
  context?: string[]
  /** Keys it puts into `state` when it starts an evaluation. */
  state?: string[]
  effects: EffectKind[]
  /** Absent by default → degrade instead of refuse. */
  optionalByDefault?: boolean
}

/**
 * The standard interfaces this engine knows (ADR 0007 table). Versions are
 * semver; documents require ranges (`^1`), runtimes provide exact versions.
 */
export const CAPABILITIES: Record<string, CapabilityInterface> = {
  'web.pages': { name: 'web.pages', version: '1.0.0', surface: 'client', description: 'Serves `page:*` templates at routes.', context: ['app', 'base', 'path', 'page'], effects: ['screen'] },
  'web.state': { name: 'web.state', version: '1.0.0', surface: 'client', description: 'Keeps `content.state` alive across pages and visits; two-way `model` bindings.', effects: ['screen'] },
  'web.router': { name: 'web.router', version: '1.0.0', surface: 'client', description: 'Client navigation: `navigate`, page `enter`, `context.params/query`.', actions: { navigate: {} }, context: ['params', 'query'], effects: ['screen'] },
  'ui.toast': { name: 'ui.toast', version: '1.0.0', surface: 'client', description: 'Transient notifications.', actions: { toast: {} }, effects: ['screen'], optionalByDefault: true },
  'http.client': { name: 'http.client', version: '1.0.0', surface: 'client', description: 'Calls endpoints from the browser: `fetch`, `submit`, `context.busy`.', actions: { fetch: {}, submit: {} }, context: ['busy'], effects: ['network'] },
  'http.endpoints': { name: 'http.endpoints', version: '1.0.0', surface: 'server', description: 'Serves the `endpoints` section over HTTP.', sections: ['endpoints'], actions: { respond: { ends: true }, fail: { ends: true } }, context: ['method', 'path', 'endpoint', 'params', 'query', 'createdUnder'], state: ['body', 'query', 'params'], effects: ['network'] },
  'storage.collections': { name: 'storage.collections', version: '1.0.0', surface: 'server', description: 'Persists the `collections` section; data actions.', sections: ['collections'], actions: { insert: {}, find: {}, findOne: {}, count: {}, patch: {}, delete: {} }, effects: ['storage'] },
  'time.now': { name: 'time.now', version: '1.0.0', surface: 'any', description: 'Injects `context.now`, one instant per evaluation.', context: ['now'], effects: ['none'] },
  'records.pinned': { name: 'records.pinned', version: '1.0.0', surface: 'server', description: 'Built-in records API: `submit` without an endpoint, pinned by `createdUnder`.', effects: ['storage', 'network'] },
  'vocab.base': { name: 'vocab.base', version: `${SPEC_VERSION}.0`, surface: 'client', description: 'The portable component vocabulary of the spec (ADR 0010).', effects: ['screen'] },
  'vocab.nuxt-ui': { name: 'vocab.nuxt-ui', version: '0.0.0', surface: 'client', description: 'Nuxt UI components (`U*`), versioned by registry hash.', effects: ['screen'] },
  'vocab.app': { name: 'vocab.app', version: '0.0.0', surface: 'client', description: 'Components the host app contributes, versioned by registry hash.', effects: ['screen'] },
  // Reserved, not specified (ADR 0007, 0027). The engine evaluates `access`
  // rules and reads `context.actor`; who fills the actor is the provider's job.
  'identity': { name: 'identity', version: '0.1.0', surface: 'any', description: 'Who is acting: injects `context.actor`; `access` rules on endpoints (ADR 0027).', context: ['actor'], effects: ['none'] },
  'dataset.fetch': { name: 'dataset.fetch', version: '0.0.0', surface: 'any', description: 'Reserved: datasets by hash, fetched before evaluation (ADR 0021).', effects: ['network'] },
  'secrets': { name: 'secrets', version: '0.0.0', surface: 'server', description: 'Reserved: secret references resolved at the edge (ADR 0021).', effects: ['none'] },
  'crypto': { name: 'crypto', version: '0.0.0', surface: 'any', description: 'Reserved: hashing and signatures as operators (ADR 0021).', effects: ['none'] },
}

/** The capability an action type belongs to (`undefined` for kernel transforms). */
export function capabilityOfAction(type: string): CapabilityInterface | undefined {
  for (const capability of Object.values(CAPABILITIES)) if (capability.actions?.[type]) return capability
  return undefined
}

export interface Requirements {
  /** Critical: name → semver range. */
  requires: Record<string, string>
  /** Optional: name → semver range. */
  optional: Record<string, string>
  /** Provider options the document authored (`storage.collections.storage`). */
  options: Record<string, Record<string, unknown>>
  /** Why each capability is required: the sections that use it. */
  reasons: Record<string, string[]>
}

function caret(version: string): string {
  const [major, minor] = version.split('.')
  return major === '0' ? `^0.${minor ?? '0'}` : `^${major}`
}

/**
 * Derive what a document requires from its references (ADR 0007 table),
 * then apply the authored `content.runtime.requires/optional`: authored
 * entries pin a range or promote an optional capability, never remove one.
 */
export function requirementsOf(document: BlueprintDocument, refs: Record<string, RefSet> = refsOfDocument(document), registry?: { base?: string[], nuxtUi?: string[], app?: string[] }): Requirements {
  const reasons: Record<string, Set<string>> = {}
  const need = (name: string, where: string) => (reasons[name] ||= new Set()).add(where)
  const content = document.content

  for (const [name, template] of Object.entries(content.templates || {})) {
    if (name.startsWith('page:')) {
      need('web.pages', `templates.${name}`)
      if (isPageTemplate(template) && template.enter) need('web.router', `templates.${name}.enter`)
    }
  }
  if (content.state && Object.keys(content.state).length) need('web.state', 'state')
  if (content.collections && Object.keys(content.collections).length) need('storage.collections', 'collections')
  if (content.endpoints && Object.keys(content.endpoints).length) {
    need('http.endpoints', 'endpoints')
    if (Object.values(content.endpoints).some(endpoint => endpoint?.pinned)) need('records.pinned', 'endpoints')
    for (const [name, endpoint] of Object.entries(content.endpoints)) if (endpoint?.access !== undefined) need('identity', `endpoints.${name}.access`)
  }
  for (const [section, set] of Object.entries(refs)) {
    for (const type of set.actionTypes) {
      const capability = capabilityOfAction(type)
      if (capability) need(capability.name, section)
      if ((type === 'submit') && [...set.submitsToRecords].length) need('records.pinned', section)
    }
    for (const key of set.contextKeys) {
      if (key === 'now') need('time.now', section)
      if (key === 'actor') need('identity', section)
      if (key === 'params' || key === 'query') need('web.router', section)
      if (key === 'busy') need('http.client', section)
    }
    if (set.models.size) need('web.state', section)
    for (const component of set.components) need(vocabularyOf(component, registry), section)
  }

  const requires: Record<string, string> = {}
  const optional: Record<string, string> = {}
  for (const name of Object.keys(reasons).sort()) {
    const capability = CAPABILITIES[name]
    const range = caret(capability?.version || '1.0.0')
    if (capability?.optionalByDefault) optional[name] = range
    else requires[name] = range
  }
  const authored = content.runtime || {}
  for (const [name, range] of Object.entries(authored.optional || {})) {
    if (requires[name]) continue // derived critical stays critical
    optional[name] = range
  }
  for (const [name, range] of Object.entries(authored.requires || {})) {
    Reflect.deleteProperty(optional, name)
    requires[name] = range
  }
  const options: Record<string, Record<string, unknown>> = {}
  if (authored.storage) options['storage.collections'] = { storage: authored.storage }
  return {
    requires,
    optional,
    options,
    reasons: Object.fromEntries(Object.entries(reasons).map(([name, set]) => [name, [...set].sort()])),
  }
}

// ---- semver (the subset documents and runtimes use) ---------------------------

export function parseVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(version.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)]
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return 0
}

/**
 * Does `version` satisfy `range`? Supports `*`, exact, `^x[.y[.z]]`,
 * `~x.y[.z]`, comparators (`>=0.1 <0.2`) and `||` alternatives. Build
 * metadata (`+hash`) is ignored by comparison; a range may pin it with
 * `=1.2.3+hash`, which then requires the same build.
 */
export function satisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version)
  if (!parsed) return false
  return range.split('||').some(alternative => alternative.trim().split(/\s+/).filter(Boolean).every((part) => {
    if (part === '*' || part === 'x') return true
    if (part.startsWith('=') && part.includes('+')) return version.trim() === part.slice(1)
    const prefix = /^[\^~]|^[<>]=?|^=/.exec(part)?.[0] || ''
    const target = parseVersion(part.slice(prefix.length))
    if (!target) return false
    const written = part.slice(prefix.length).split('.').length
    const order = compare(parsed, target)
    switch (prefix) {
      case '': case '=': return written === 3 ? order === 0 : written === 2 ? parsed[0] === target[0] && parsed[1] === target[1] : parsed[0] === target[0]
      case '>': return order > 0
      case '>=': return order >= 0
      case '<': return order < 0
      case '<=': return order <= 0
      case '~': return order >= 0 && parsed[0] === target[0] && (written === 1 || parsed[1] === target[1])
      case '^': {
        if (order < 0) return false
        if (target[0] > 0) return parsed[0] === target[0]
        if (target[1] > 0 || written < 3) return parsed[0] === 0 && parsed[1] === target[1]
        return compare(parsed, target) === 0
      }
      default: return false
    }
  }))
}

// ---- compatibility --------------------------------------------------------------

export interface Provided {
  name: string
  version: string
  surface?: Surface
  options?: Record<string, unknown>
  components?: string[]
}

export type Verdict = 'compatible' | 'degraded' | 'incompatible'

export interface CompatibilityReport {
  verdict: Verdict
  /** Critical capabilities absent or at a wrong version. */
  missing: Array<{ name: string, required: string, provided?: string, code: 'CAPABILITY_MISSING' | 'CAPABILITY_VERSION' }>
  /** Optional capabilities absent: the document runs without them. */
  unavailable: Array<{ name: string, required: string, provided?: string }>
  /** Spec problem, when the document's spec is outside the runtime's range. */
  spec?: { document: string, runtime: string }
}

export function checkCompatibility(
  wanted: { spec?: string, requires: Record<string, string>, optional: Record<string, string> },
  runtime: { spec?: string, provides: Provided[] },
): CompatibilityReport {
  const report: CompatibilityReport = { verdict: 'compatible', missing: [], unavailable: [] }
  const byName = new Map(runtime.provides.map(entry => [entry.name, entry]))
  if (wanted.spec && runtime.spec && !satisfies(`${wanted.spec}.0`, runtime.spec)) {
    report.spec = { document: wanted.spec, runtime: runtime.spec }
    report.verdict = 'incompatible'
  }
  for (const [name, range] of Object.entries(wanted.requires)) {
    const provided = byName.get(name)
    if (!provided) report.missing.push({ name, required: range, code: 'CAPABILITY_MISSING' })
    else if (!satisfies(provided.version, range)) report.missing.push({ name, required: range, provided: provided.version, code: 'CAPABILITY_VERSION' })
  }
  for (const [name, range] of Object.entries(wanted.optional)) {
    const provided = byName.get(name)
    // A wrong version is worse than an absence: it runs and differs (ADR 0007).
    if (provided && !satisfies(provided.version, range)) report.missing.push({ name, required: range, provided: provided.version, code: 'CAPABILITY_VERSION' })
    else if (!provided) report.unavailable.push({ name, required: range })
  }
  if (report.missing.length) report.verdict = 'incompatible'
  else if (report.unavailable.length) report.verdict = 'degraded'
  return report
}
